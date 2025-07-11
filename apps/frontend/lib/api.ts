export interface Config {
  search_api: string;
  planner_model: string;
  writer_model: string;
  summarization_model: string;
  max_search_depth: number;
  report_structure: string;
}

export interface StartConversationRequest {
  topic: string;
  config?: Config;
}

export interface ContinueConversationRequest {
  thread_id: string;
  feedback: string | boolean;
  config?: Config;
}

export interface StreamEvent {
  content: string;
  type: string;
}

// Add a new type for stream end event
export interface StreamEndEvent extends StreamEvent {
  type: 'stream_end';
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://0.0.0.0:8000';

export async function* startConversationStream(request: StartConversationRequest): AsyncGenerator<StreamEvent | StreamEndEvent, void, unknown> {
  const response = await fetch(`${API_BASE_URL}/start-conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to start conversation');
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body');
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data as StreamEvent | StreamEndEvent;
            // If we receive a stream_end event, we can break the loop
            if (data.type === 'stream_end') {
              return;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* continueConversationStream(request: ContinueConversationRequest): AsyncGenerator<StreamEvent | StreamEndEvent, void, unknown> {
  const response = await fetch(`${API_BASE_URL}/continue-conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to continue conversation');
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body');
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data as StreamEvent | StreamEndEvent;
            // If we receive a stream_end event, we can break the loop
            if (data.type === 'stream_end') {
              return;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Keep legacy functions for compatibility if needed
export interface ConversationResponse {
  thread_id: string;
  events: any[];
  interrupt_value?: string;
}

export async function startConversation(request: StartConversationRequest): Promise<ConversationResponse> {
  const response = await fetch(`${API_BASE_URL}/start-conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to start conversation');
  }

  return response.json();
}

export async function continueConversation(request: ContinueConversationRequest): Promise<ConversationResponse> {
  const response = await fetch(`${API_BASE_URL}/continue-conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to continue conversation');
  }

  return response.json();
} 
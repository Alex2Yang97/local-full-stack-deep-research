export interface Config {
  planner_provider?: string;
  planner_model?: string;
  search_api?: string;
  writer_model?: string;
  writer_provider?: string;
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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://0.0.0.0:80';

export async function* startConversationStream(request: StartConversationRequest): AsyncGenerator<StreamEvent, void, unknown> {
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
            yield data as StreamEvent;
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

export async function* continueConversationStream(request: ContinueConversationRequest): AsyncGenerator<StreamEvent, void, unknown> {
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
            yield data as StreamEvent;
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
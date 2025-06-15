'use client';

import { useState, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible } from '@/components/ui/collapsible';
import { startConversationStream, continueConversationStream, StreamEvent } from '@/lib/api';
import { Loader2, Trash2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'user' | 'final' | 'intermediate';
}

interface IntermediateStep {
  type: string;
  content: string;
  displayName: string;
}

const INTERMEDIATE_STEP_TYPES = [
  'query_writer',
  'report_planner', 
  'query_generator',
  'writer',
  'section_grader',
  'final_section_writer'
];

const STEP_DISPLAY_NAMES: Record<string, string> = {
  query_writer: 'Query Writer',
  report_planner: 'Report Planner',
  query_generator: 'Query Generator',
  writer: 'Content Writer',
  section_grader: 'Section Grader',
  final_section_writer: 'Final Section Writer'
};

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [waitingForFeedback, setWaitingForFeedback] = useState(false);
  const [intermediateSteps, setIntermediateSteps] = useState<IntermediateStep[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearChat = () => {
    setMessages([]);
    setThreadId(null);
    setWaitingForFeedback(false);
    setIntermediateSteps([]);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const processStreamEvent = (event: StreamEvent) => {
    switch (event.type) {
      case 'thread_id':
        if (!threadId) {
          setThreadId(event.content);
        }
        break;
        
      case 'interrupt':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: event.content,
          type: 'final'
        }]);
        setWaitingForFeedback(true);
        break;
        
      case 'compile_final_report':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: event.content,
          type: 'final'
        }]);
        setWaitingForFeedback(false);
        break;
        
      default:
        if (INTERMEDIATE_STEP_TYPES.includes(event.type)) {
          setIntermediateSteps(prev => {
            const existingStepIndex = prev.findIndex(step => step.type === event.type);
            if (existingStepIndex >= 0) {
              // Append to existing step
              const updated = [...prev];
              updated[existingStepIndex].content += event.content;
              return updated;
            } else {
              // Create new step
              return [...prev, {
                type: event.type,
                content: event.content,
                displayName: STEP_DISPLAY_NAMES[event.type] || event.type
              }];
            }
          });
        }
        break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: userMessage, type: 'user' }]);

    // Clear intermediate steps for new request
    setIntermediateSteps([]);

    abortControllerRef.current = new AbortController();

    try {
      if (!threadId) {
        // Start new conversation
        const stream = startConversationStream({ topic: userMessage });
        
        for await (const event of stream) {
          if (abortControllerRef.current?.signal.aborted) break;
          processStreamEvent(event);
        }
      } else if (waitingForFeedback) {
        // Continue conversation with feedback
        const feedback = userMessage.toLowerCase() === 'yes';
        const stream = continueConversationStream({
          thread_id: threadId,
          feedback: feedback
        });

        for await (const event of stream) {
          if (abortControllerRef.current?.signal.aborted) break;
          processStreamEvent(event);
        }
      } else {
        // Continue conversation with new topic
        const stream = continueConversationStream({
          thread_id: threadId,
          feedback: userMessage
        });

        for await (const event of stream) {
          if (abortControllerRef.current?.signal.aborted) break;
          processStreamEvent(event);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: 'Sorry, an error occurred. Please try again.', 
          type: 'final' 
        }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-[80vh] max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Deep Research Assistant</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={clearChat}
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Clear Chat
        </Button>
      </div>

      <Card className="flex-1 p-4 overflow-auto">
        <div className="space-y-4">
          {messages.map((message, i) => (
            <div
              key={i}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`rounded-lg px-4 py-2 max-w-[80%] ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : message.type === 'final'
                    ? 'bg-green-50 border border-green-200 text-green-900'
                    : 'bg-muted'
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans text-sm">
                  {message.content}
                </pre>
              </div>
            </div>
          ))}

          {/* Show intermediate steps */}
          {intermediateSteps.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">
                Processing Steps:
              </div>
              {intermediateSteps.map((step, i) => (
                <Collapsible
                  key={`${step.type}-${i}`}
                  trigger={
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{step.displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        ({step.content.length} chars)
                      </span>
                    </div>
                  }
                  defaultOpen={false}
                  className="bg-blue-50 border border-blue-200 rounded-lg p-2"
                >
                  <div className="text-sm text-blue-900 font-mono bg-white p-3 rounded border">
                    <pre className="whitespace-pre-wrap">
                      {step.content}
                    </pre>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}

          {isLoading && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Processing...</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            waitingForFeedback
              ? "Type 'yes' to proceed with the plan, or provide feedback..."
              : threadId
              ? "Continue the conversation or ask a new question..."
              : "What would you like to research?"
          }
          disabled={isLoading}
          className="flex-1"
        />
        <Button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
        </Button>
      </form>

      {threadId && (
        <div className="text-xs text-muted-foreground text-center">
          Thread ID: {threadId}
        </div>
      )}
    </div>
  );
} 
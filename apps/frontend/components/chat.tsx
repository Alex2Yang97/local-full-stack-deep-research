'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible } from '@/components/ui/collapsible';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  startConversationStream, 
  continueConversationStream, 
  StreamEvent,
  Config 
} from '@/lib/api';
import { Loader2, CheckCircle, Circle, Download, RotateCcw, Expand, Minimize2, Square } from 'lucide-react';

interface IntermediateStep {
  type: string;
  content: string;
  displayName: string;
}

const DEFAULT_REPORT_STRUCTURE = `Use this structure to create a report on the user-provided topic:

1. Introduction (no research needed)
   - Brief overview of the topic area

2. Main Body Sections:
   - Each section should focus on a sub-topic of the user-provided topic
   
3. Conclusion
   - Aim for 1 structural element (either a list of table) that distills the main body sections 
   - Provide a concise summary of the report`;

// Streaming steps for research plan phase
const PLAN_STEP_TYPES = [
  'query_writer',
  'report_planner'
];

// Streaming steps for execution phase
const EXECUTION_STEP_TYPES = [
  'query_generator',
  'writer',
  'section_grader'
];

const STEP_DISPLAY_NAMES: Record<string, string> = {
  query_writer: 'Query Writer',
  report_planner: 'Report Planner',
  query_generator: 'Query Generator',
  writer: 'Content Writer',
  section_grader: 'Section Grader',
  final_section_writer: 'Final Section Writer'
};

const EXECUTION_STEPS = [
  { id: 'information_gathering', name: 'Information gathering' },
  { id: 'summarizing', name: 'Summarizing' },
  { id: 'report_generation', name: 'Report generation' }
];

type ResearchState = 'initial' | 'planning' | 'plan_review' | 'executing' | 'completed';

export function Chat() {
  const [topic, setTopic] = useState('');
  const [config, setConfig] = useState<Config>({
    search_api: 'tavily',
    planner_model: 'gpt-4o-mini',
    writer_model: 'gpt-4o-mini',
    summarization_model: 'gpt-4o-mini',
    max_search_depth: 2,
    report_structure: DEFAULT_REPORT_STRUCTURE
  });
  
  const [state, setState] = useState<ResearchState>('initial');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [researchPlan, setResearchPlan] = useState('');
  const [finalReport, setFinalReport] = useState('');
  const [planStreamingSteps, setPlanStreamingSteps] = useState<IntermediateStep[]>([]);
  const [executionStreamingSteps, setExecutionStreamingSteps] = useState<IntermediateStep[]>([]);
  const [executionSteps, setExecutionSteps] = useState<Record<string, boolean>>({});
  const [currentStep, setCurrentStep] = useState<string>('');
  const [feedback, setFeedback] = useState('');
  const [isPlanExpanded, setIsPlanExpanded] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetResearch = () => {
    setState('initial');
    setThreadId(null);
    setResearchPlan('');
    setFinalReport('');
    setPlanStreamingSteps([]);
    setExecutionStreamingSteps([]);
    setExecutionSteps({});
    setCurrentStep('');
    setTopic('');
    setFeedback('');
    setIsPlanExpanded(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const stopResearch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Reset to appropriate state based on current state
    if (state === 'planning') {
      setState('initial');
      setResearchPlan('');
      setPlanStreamingSteps([]);
    } else if (state === 'executing') {
      setState('plan_review'); // Go back to plan review
      setExecutionStreamingSteps([]);
      setExecutionSteps({});
      setCurrentStep('');
      setFinalReport('');
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
        setResearchPlan(event.content);
        setState('plan_review');
        break;
        
      case 'compile_final_report':
        setFinalReport(event.content);
        setState('completed');
        break;

      case 'final_section_writer':
        // Handle final_section_writer as final report content
        setFinalReport(prev => prev + event.content);
        break;
        
      default:
        // Handle planning phase streaming steps
        if (PLAN_STEP_TYPES.includes(event.type)) {
          setPlanStreamingSteps(prev => {
            const existingStepIndex = prev.findIndex(step => step.type === event.type);
            if (existingStepIndex >= 0) {
              const updated = [...prev];
              updated[existingStepIndex].content += event.content;
              return updated;
            } else {
              return [...prev, {
                type: event.type,
                content: event.content,
                displayName: STEP_DISPLAY_NAMES[event.type] || event.type
              }];
            }
          });
        }
        
        // Handle execution phase streaming steps
        if (EXECUTION_STEP_TYPES.includes(event.type)) {
          // Update execution steps based on current activity
          if (event.type === 'query_generator') {
            setCurrentStep('information_gathering');
            setExecutionSteps(prev => ({ ...prev, information_gathering: false }));
          } else if (event.type === 'section_grader') {
            setCurrentStep('summarizing');
            setExecutionSteps(prev => ({ ...prev, information_gathering: true, summarizing: false }));
          } else if (event.type === 'writer') {
            setCurrentStep('report_generation');
            setExecutionSteps(prev => ({ ...prev, summarizing: true, report_generation: false }));
          }

          setExecutionStreamingSteps(prev => {
            const existingStepIndex = prev.findIndex(step => step.type === event.type);
            if (existingStepIndex >= 0) {
              const updated = [...prev];
              updated[existingStepIndex].content += event.content;
              return updated;
            } else {
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

  const startResearch = async () => {
    if (!topic.trim()) return;
    
    setState('planning');
    setPlanStreamingSteps([]);
    setExecutionStreamingSteps([]);
    setResearchPlan('');
    abortControllerRef.current = new AbortController();

    try {
      const stream = startConversationStream({ 
        topic: topic.trim(),
        config 
      });
      
      for await (const event of stream) {
        if (abortControllerRef.current?.signal.aborted) break;
        processStreamEvent(event);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Research error:', error);
        setState('initial');
      }
    }
  };

  const confirmPlan = async (approved: boolean) => {
    if (!threadId) return;
    
    if (!approved && !feedback.trim()) {
      alert('Please provide feedback for regeneration.');
      return;
    }
    
    setState('executing');
    setExecutionSteps({});
    setCurrentStep('');
    setExecutionStreamingSteps([]);
    setFinalReport('');
    
    abortControllerRef.current = new AbortController();

    try {
      const stream = continueConversationStream({
        thread_id: threadId,
        feedback: approved ? true : feedback.trim(),
        config
      });

      for await (const event of stream) {
        if (abortControllerRef.current?.signal.aborted) break;
        processStreamEvent(event);
      }
      
      // Mark final step as complete when done
      setExecutionSteps(prev => ({ ...prev, report_generation: true }));
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Execution error:', error);
        setState('plan_review');
      }
    }
  };

  const exportReport = () => {
    const blob = new Blob([finalReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research_report_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const isProcessing = state === 'planning' || state === 'executing';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Deep Research Assistant</h1>
          <div className="flex gap-2">
            {isProcessing && (
              <Button
                variant="destructive"
                onClick={stopResearch}
                className="flex items-center gap-2"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            )}
            <Button
              variant="outline"
              onClick={resetResearch}
              disabled={isProcessing}
              className="flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              New Research
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Settings Panel - Fixed width */}
          <div className="lg:col-span-4 xl:col-span-3">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Topic</label>
                  <Input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Enter your research topic..."
                    disabled={state !== 'initial'}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-2 block">Planner Model</label>
                  <Select
                    value={config.planner_model}
                    onChange={(e) => setConfig(prev => ({ ...prev, planner_model: e.target.value }))}
                    disabled={state !== 'initial'}
                  >
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="llama3.1">Llama3.1</option>
                    <option value="claude-3-7-sonnet-latest">Claude 3.7 Sonnet</option>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Writer Model</label>
                  <Select
                    value={config.writer_model}
                    onChange={(e) => setConfig(prev => ({ ...prev, writer_model: e.target.value }))}
                    disabled={state !== 'initial'}
                  >
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="llama3.1">Llama3.1</option>
                    <option value="claude-3-7-sonnet-latest">Claude 3.7 Sonnet</option>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Summarization Model</label>
                  <Select
                    value={config.summarization_model}
                    onChange={(e) => setConfig(prev => ({ ...prev, summarization_model: e.target.value }))}
                    disabled={state !== 'initial'}
                  >
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="llama3.1">Llama3.1</option>
                    <option value="claude-3-7-sonnet-latest">Claude 3.7 Sonnet</option>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Search Depth</label>
                  <Select
                    value={config.max_search_depth.toString()}
                    onChange={(e) => setConfig(prev => ({ ...prev, max_search_depth: parseInt(e.target.value) }))}
                    disabled={state !== 'initial'}
                  >
                    <option value="1">Shallow (1)</option>
                    <option value="2">Medium (2)</option>
                    <option value="3">Deep (3)</option>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Report Structure</label>
                  <Textarea
                    value={config.report_structure}
                    onChange={(e) => setConfig(prev => ({ ...prev, report_structure: e.target.value }))}
                    placeholder="Define the structure of your report..."
                    className="min-h-[120px]"
                    disabled={state !== 'initial'}
                  />
                </div>

                <Button
                  onClick={startResearch}
                  disabled={!topic.trim() || state !== 'initial'}
                  className="w-full"
                >
                  {state === 'planning' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Generating Plan...
                    </>
                  ) : (
                    'Generate Research Plan'
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-6">
            {/* Research Plan - Always visible */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Research Plan</CardTitle>
                {researchPlan && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsPlanExpanded(!isPlanExpanded)}
                    className="flex items-center gap-2"
                  >
                    {isPlanExpanded ? (
                      <>
                        <Minimize2 className="h-4 w-4" />
                        Collapse
                      </>
                    ) : (
                      <>
                        <Expand className="h-4 w-4" />
                        Expand
                      </>
                    )}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {state === 'initial' && (
                  <div className="text-center text-muted-foreground py-8">
                    <p>Configure your settings and enter a topic to generate a research plan.</p>
                  </div>
                )}
                
                {state === 'planning' && (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Generating research plan...</span>
                    </div>
                  </div>
                )}

                {/* Plan streaming steps - Always show after they start appearing, positioned above the plan */}
                {planStreamingSteps.length > 0 && (
                  <div className="space-y-2 mb-6">
                    <div className="text-sm font-medium text-muted-foreground">
                      Planning Steps:
                    </div>
                    {planStreamingSteps.map((step, i) => (
                      <Collapsible
                        key={`plan-${step.type}-${i}`}
                        trigger={
                          <div className="flex items-center gap-2">
                            {state === 'planning' && (
                              <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                            )}
                            <span className="text-sm font-medium">{step.displayName}</span>
                            <span className="text-xs text-muted-foreground">
                              ({step.content.length} chars)
                            </span>
                          </div>
                        }
                        defaultOpen={false}
                        className="bg-blue-50 border border-blue-200 rounded-lg p-2"
                      >
                        <div className="text-xs text-blue-900 font-mono bg-white p-3 rounded border max-h-40 overflow-y-auto">
                          <pre className="whitespace-pre-wrap">
                            {step.content}
                          </pre>
                        </div>
                      </Collapsible>
                    ))}
                  </div>
                )}

                {researchPlan && (
                  <div className="space-y-4">
                    <div className="prose max-w-none">
                      <div 
                        className={`bg-gray-50 p-4 rounded-lg border ${
                          isPlanExpanded ? 'max-h-none' : 'max-h-64 overflow-y-auto'
                        }`}
                      >
                        <pre className="whitespace-pre-wrap text-sm">
                          {researchPlan}
                        </pre>
                      </div>
                    </div>

                    {state === 'plan_review' && (
                      <div className="space-y-3 pt-4 border-t">
                        <div>
                          <label className="text-sm font-medium mb-2 block">
                            Feedback (required for regeneration)
                          </label>
                          <Textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="Provide feedback to improve the plan (only required if you want to regenerate)..."
                            className="min-h-[80px]"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            onClick={() => confirmPlan(false)} 
                            variant="outline"
                            disabled={!feedback.trim()}
                          >
                            Regenerate
                          </Button>
                          <Button onClick={() => confirmPlan(true)}>
                            Confirm & Execute
                          </Button>
                        </div>
                      </div>
                    )}

                    {(state === 'executing' || state === 'completed') && (
                      <div className="pt-4 border-t">
                        <div className="text-sm text-muted-foreground">
                          {state === 'executing' ? '✓ Plan confirmed - Executing...' : '✓ Plan executed successfully'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Execution Steps */}
            {(state === 'executing' || state === 'completed') && (
              <Card>
                <CardHeader>
                  <CardTitle>Step 2: Execute Plan</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground mb-4">
                      {state === 'executing' ? 'Executing plan...' : 'Plan executed successfully'}
                    </div>
                    
                    {/* High-level execution steps */}
                    <div className="space-y-3">
                      {EXECUTION_STEPS.map((step, index) => (
                        <div key={step.id} className="flex items-center gap-3">
                          {executionSteps[step.id] ? (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          ) : currentStep === step.id ? (
                            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                          ) : (
                            <Circle className="h-5 w-5 text-gray-400" />
                          )}
                          <span className={`text-sm ${
                            executionSteps[step.id] ? 'text-green-600' : 
                            currentStep === step.id ? 'text-blue-600' : 'text-gray-600'
                          }`}>
                            Step {index + 1}: {step.name}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Execution streaming steps - Collapsible */}
                    {executionStreamingSteps.length > 0 && (
                      <div className="mt-6 space-y-2">
                        <div className="text-sm font-medium text-muted-foreground">
                          Detailed Processing Steps:
                        </div>
                        {executionStreamingSteps.map((step, i) => (
                          <Collapsible
                            key={`exec-${step.type}-${i}`}
                            trigger={
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{step.displayName}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({step.content.length} chars)
                                </span>
                                {currentStep && (
                                  step.type === 'query_generator' ? 
                                    currentStep === 'information_gathering' :
                                  step.type === 'section_grader' ?
                                    currentStep === 'summarizing' :
                                  step.type === 'writer' ?
                                    currentStep === 'report_generation' : false
                                ) && (
                                  <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                                )}
                              </div>
                            }
                            defaultOpen={false}
                            className="bg-blue-50 border border-blue-200 rounded-lg p-2"
                          >
                            <div className="text-xs text-blue-900 font-mono bg-white p-3 rounded border max-h-40 overflow-y-auto">
                              <pre className="whitespace-pre-wrap">
                                {step.content}
                              </pre>
                            </div>
                          </Collapsible>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Research Report */}
            {state === 'completed' && finalReport && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Research Report</CardTitle>
                  <Button onClick={exportReport} size="sm" className="flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    Export
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none">
                    <div className="bg-white p-6 rounded-lg border max-h-96 overflow-y-auto">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mb-4" {...props} />,
                          h2: ({ node, ...props }) => <h2 className="text-xl font-semibold mb-3" {...props} />,
                          h3: ({ node, ...props }) => <h3 className="text-lg font-medium mb-2" {...props} />,
                          li: ({ node, ...props }) => <li className="ml-4" {...props} />,
                          p: ({ node, ...props }) => <p className="mb-4" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
                          em: ({ node, ...props }) => <em className="italic" {...props} />
                        }}
                      >
                        {finalReport}
                      </ReactMarkdown>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uuid
from typing import Optional, Dict, Any
from langgraph.checkpoint.memory import MemorySaver
from open_deep_research.graph import builder
from langgraph.types import Command

app = FastAPI()
memory = MemorySaver()
graph = builder.compile(checkpointer=memory)

class StartConversationRequest(BaseModel):
    topic: str
    config: Optional[Dict[str, Any]] = None
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "topic": "What is the mcp protocol?", 
                    "config": {
                        "planner_provider": "openai",
                        "planner_model": "gpt-4o-mini", 
                        "search_api": "tavily",
                        "writer_model": "gpt-4o-mini",
                        "writer_provider": "openai",
                    }
                }
            ]   
        }
    }

class ContinueConversationRequest(BaseModel):
    thread_id: str
    feedback: str | bool

class ConversationResponse(BaseModel):
    thread_id: str
    events: list
    interrupt_value: Optional[str] = None


@app.post("/start-conversation")
async def start_conversation(request: StartConversationRequest):
    try:
        thread_id = str(uuid.uuid4())
        thread = {
            "configurable": {
                "thread_id": thread_id,
                "max_search_depth": 2,
                **(request.config or {})
            }
        }
        
        events = []
        interrupt_value = None
        
        async for event in graph.astream({"topic": request.topic}, thread, stream_mode="updates"):
            if '__interrupt__' in event:
                interrupt_value = event['__interrupt__'][0].value
                break
            events.append(event)
            
        return ConversationResponse(
            thread_id=thread_id,
            events=events,
            interrupt_value=interrupt_value
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/continue-conversation")
async def continue_conversation(request: ContinueConversationRequest):
    try:
        thread = {"configurable": {"thread_id": request.thread_id}}
        events = []
        interrupt_value = None
        
        async for event in graph.astream(Command(resume=request.feedback), thread, stream_mode="updates"):
            if '__interrupt__' in event:
                interrupt_value = event['__interrupt__'][0].value
                break
            events.append(event)
            
        return ConversationResponse(
            thread_id=request.thread_id,
            events=events,
            interrupt_value=interrupt_value
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

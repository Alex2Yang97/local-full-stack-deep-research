from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uuid
from typing import Optional, Dict, Any
from langgraph.checkpoint.memory import MemorySaver
from open_deep_research.graph import builder
from langgraph.types import Command
from dotenv import load_dotenv
from sse_starlette.sse import EventSourceResponse
import json


# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for debugging
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

memory = MemorySaver()
graph = builder.compile(checkpointer=memory)


REPORT_STRUCTURE = """Use this structure to create a report on the user-provided topic:

1. Introduction (no research needed)
   - Brief overview of the topic area

2. Main Body Sections:
   - Each section should focus on a sub-topic of the user-provided topic
   
3. Conclusion
   - Aim for 1 structural element (either a list of table) that distills the main body sections 
   - Provide a concise summary of the report"""
   

class StartConversationRequest(BaseModel):
    topic: str
    config: Optional[Dict[str, Any]] = None
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "topic": "What is the mcp protocol?", 
                    "config": {
                        "search_api": "tavily",
                        "planner_model": "gpt-4o-mini", 
                        "writer_model": "gpt-4o-mini",
                        "summarization_model": "gpt-4o-mini",
                        "max_search_depth": 2,
                        "report_structure": REPORT_STRUCTURE,
                    }
                }
            ]   
        }
    }

class ContinueConversationRequest(BaseModel):
    thread_id: str
    feedback: str | bool
    config: Optional[Dict[str, Any]] = None
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "thread_id": "123",
                    "feedback": True,
                    "config": {
                        "search_api": "tavily",
                        "planner_model": "gpt-4o-mini",
                        "writer_model": "gpt-4o-mini",
                        "summarization_model": "gpt-4o-mini",
                        "max_search_depth": 2,
                        "report_structure": REPORT_STRUCTURE,
                    }
                }
            ]   
        }
    }

class ConversationResponse(BaseModel):
    thread_id: str
    events: list
    interrupt_value: Optional[str] = None


async def astreaming_graph(graph_input, thread):
    yield json.dumps({"content": thread["configurable"]["thread_id"], "type": "thread_id"})
    async for mode, chunk in graph.astream(
        graph_input, thread, stream_mode=["messages", "updates"]
    ):  
        if mode == "messages":
            msg, metadata = chunk
            if metadata["tags"] == ["query_writer"]:
                yield json.dumps({"content": msg.content, "type": "query_writer"})
            if metadata["tags"] == ["report_planner"]:
                yield json.dumps({"content": msg.content, "type": "report_planner"})
            if metadata["tags"] == ["query_generator"]:
                yield json.dumps({"content": msg.content, "type": "query_generator"})
            if metadata["tags"] == ["writer"]:
                yield json.dumps({"content": msg.content, "type": "writer"})
            if metadata["tags"] == ["section_grader"]:
                yield json.dumps({"content": msg.content, "type": "section_grader"})
            if metadata["tags"] == ["final_section_writer"]:
                yield json.dumps({"content": msg.content, "type": "final_section_writer"})
        if mode == "updates":
            if "__interrupt__" in chunk:
                yield json.dumps({"content": chunk["__interrupt__"][0].value, "type": "interrupt"})
            if "compile_final_report" in chunk:
                yield json.dumps({"content": chunk["compile_final_report"]["final_report"], "type": "compile_final_report"})
    
    # Send stream end event
    yield json.dumps({"content": "stream_end", "type": "stream_end"})


@app.post("/start-conversation")
async def start_conversation(request: StartConversationRequest):
    try:
        thread_id = str(uuid.uuid4())
        thread = {
            "configurable": {
                "thread_id": thread_id,
                **(request.config or {})
            }
        }

        return EventSourceResponse(astreaming_graph({"topic": request.topic}, thread))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/continue-conversation")
async def continue_conversation(request: ContinueConversationRequest):
    try:
        thread = {
            "configurable": {
                "thread_id": request.thread_id,
                **(request.config or {})
            }
        }
        
        return EventSourceResponse(astreaming_graph(Command(resume=request.feedback), thread))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

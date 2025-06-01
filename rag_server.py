from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import os
import logging
from typing import Optional, List, Dict
import asyncio
import aiohttp
from datetime import datetime
import hashlib
import json

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Article Summary and Chat RAG Server",
    description="Local RAG server for article summarization and chat using Gemini API",
    version="1.1.0"
)

# Add CORS middleware to allow requests from browser extensions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your extension's origin
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Load Gemini API key from environment variable
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY environment variable not set!")
    logger.info("Please set your API key: export GEMINI_API_KEY='your-api-key-here'")

# In-memory storage for chat sessions (in production, use a proper database)
chat_sessions: Dict[str, Dict] = {}


class SummaryRequest(BaseModel):
    text: str
    summary_type: str = "brief"
    api_key: Optional[str] = None


class SummaryResponse(BaseModel):
    summary: str
    text_length: int
    processing_time: float
    timestamp: str
    status: str = "success"


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: str


class ChatRequest(BaseModel):
    article_text: str
    question: str
    session_id: Optional[str] = None
    api_key: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    session_id: str
    processing_time: float
    timestamp: str
    status: str = "success"


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: List[ChatMessage]
    article_summary: str


@app.get("/")
def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "message": "Article Summary and Chat RAG Server",
        "api_key_configured": bool(GEMINI_API_KEY),
        "timestamp": datetime.now().isoformat(),
        "features": ["summarization", "chat"]
    }


@app.get("/health")
def health_check():
    """Detailed health check"""
    return {
        "status": "healthy" if GEMINI_API_KEY else "missing_api_key",
        "api_key_configured": bool(GEMINI_API_KEY),
        "gemini_api_available": True,
        "timestamp": datetime.now().isoformat(),
        "active_chat_sessions": len(chat_sessions)
    }


@app.post("/summarize", response_model=SummaryResponse)
async def summarize(req: SummaryRequest):
    """
    Summarize article text using Gemini API
    """
    start_time = datetime.now()

    # Use either the provided API key or the server's environment key
    api_key = req.api_key or GEMINI_API_KEY
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No API key provided. Please set GEMINI_API_KEY environment variable or provide an API key in the request."
        )

    if not req.text or len(req.text.strip()) < 50:
        raise HTTPException(
            status_code=400,
            detail="Text content is too short or empty. Please provide substantial text to summarize."
        )

    # Limit text length to prevent API issues
    max_length = 15000
    original_length = len(req.text)
    truncated_text = req.text[:max_length] + "..." if len(req.text) > max_length else req.text

    if original_length > max_length:
        logger.info(f"Truncated text from {original_length} to {max_length} characters")

    # Create appropriate prompt based on summary type
    prompt = create_summary_prompt(req.summary_type, truncated_text)

    try:
        # Make async request to Gemini API
        summary = await call_gemini_api(prompt, api_key)

        processing_time = (datetime.now() - start_time).total_seconds()

        logger.info(f"Successfully generated {req.summary_type} summary in {processing_time:.2f}s")

        return SummaryResponse(
            summary=summary,
            text_length=original_length,
            processing_time=processing_time,
            timestamp=datetime.now().isoformat()
        )

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Gemini API request timed out. Please try again.")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=503, detail="Unable to connect to Gemini API. Check your internet connection.")
    except Exception as e:
        logger.error(f"Error calling Gemini API: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Gemini API error: {str(e)}")


@app.post("/chat", response_model=ChatResponse)
async def chat_with_article(req: ChatRequest):
    """
    Chat with article content using Gemini API
    """
    start_time = datetime.now()

    # Use either the provided API key or the server's environment key
    api_key = req.api_key or GEMINI_API_KEY
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No API key provided. Please set GEMINI_API_KEY environment variable or provide an API key in the request."
        )

    if not req.article_text or len(req.article_text.strip()) < 50:
        raise HTTPException(
            status_code=400,
            detail="Article text is too short or empty. Please provide substantial text to chat about."
        )

    if not req.question or len(req.question.strip()) < 3:
        raise HTTPException(
            status_code=400,
            detail="Question is too short or empty. Please provide a meaningful question."
        )

    # Generate session ID if not provided
    session_id = req.session_id
    if not session_id:
        # Create session ID based on article content hash
        article_hash = hashlib.md5(req.article_text.encode()).hexdigest()
        session_id = f"session_{article_hash}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    # Initialize or retrieve chat session
    if session_id not in chat_sessions:
        # Create new session
        article_summary = await generate_article_summary_for_chat(req.article_text, api_key)
        chat_sessions[session_id] = {
            "article_text": req.article_text[:15000],  # Store truncated version
            "article_summary": article_summary,
            "messages": [],
            "created_at": datetime.now().isoformat()
        }
        logger.info(f"Created new chat session: {session_id}")

    session = chat_sessions[session_id]

    # Add user message to history
    user_message = ChatMessage(
        role="user",
        content=req.question,
        timestamp=datetime.now().isoformat()
    )
    session["messages"].append(user_message.dict())

    try:
        # Create chat prompt with context
        prompt = create_chat_prompt(
            article_text=session["article_text"],
            article_summary=session["article_summary"],
            chat_history=session["messages"],
            current_question=req.question
        )

        # Make async request to Gemini API
        answer = await call_gemini_api(prompt, api_key)

        # Add assistant message to history
        assistant_message = ChatMessage(
            role="assistant",
            content=answer,
            timestamp=datetime.now().isoformat()
        )
        session["messages"].append(assistant_message.dict())

        processing_time = (datetime.now() - start_time).total_seconds()

        logger.info(f"Successfully generated chat response for session {session_id} in {processing_time:.2f}s")

        return ChatResponse(
            answer=answer,
            session_id=session_id,
            processing_time=processing_time,
            timestamp=datetime.now().isoformat()
        )

    except Exception as e:
        logger.error(f"Error in chat API: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Chat API error: {str(e)}")


@app.get("/chat/{session_id}/history", response_model=ChatHistoryResponse)
async def get_chat_history(session_id: str):
    """
    Get chat history for a session
    """
    if session_id not in chat_sessions:
        raise HTTPException(status_code=404, detail="Chat session not found")

    session = chat_sessions[session_id]
    messages = [ChatMessage(**msg) for msg in session["messages"]]

    return ChatHistoryResponse(
        session_id=session_id,
        messages=messages,
        article_summary=session["article_summary"]
    )


@app.delete("/chat/{session_id}")
async def clear_chat_session(session_id: str):
    """
    Clear a chat session
    """
    if session_id not in chat_sessions:
        raise HTTPException(status_code=404, detail="Chat session not found")

    del chat_sessions[session_id]
    logger.info(f"Cleared chat session: {session_id}")

    return {"message": "Chat session cleared successfully", "session_id": session_id}


def create_summary_prompt(summary_type: str, text: str) -> str:
    """Create appropriate prompt based on summary type"""
    prompts = {
        "brief": f"Please provide a brief, clear summary of this article in 2-3 sentences. Focus on the main points and key information:\n\n{text}",
        "detailed": f"Please provide a comprehensive and detailed summary of this article. Cover all the key points, important details, and main arguments. Organize the information clearly:\n\n{text}",
        "bullets": f"Please summarize this article in 5-7 clear bullet points. Start each point with '• ' and make each point concise but informative:\n\n{text}",
    }
    return prompts.get(summary_type, prompts["brief"])


async def generate_article_summary_for_chat(article_text: str, api_key: str) -> str:
    """Generate a concise summary of the article for chat context"""
    truncated_text = article_text[:12000]  # Shorter for chat context
    prompt = f"""Please provide a concise summary of this article that will be used as context for answering questions. 
    Focus on the main topics, key points, and important details. Keep it informative but concise:

    {truncated_text}"""

    try:
        summary = await call_gemini_api(prompt, api_key)
        return summary
    except Exception as e:
        logger.error(f"Error generating article summary for chat: {str(e)}")
        return "Summary unavailable due to processing error."


def create_chat_prompt(article_text: str, article_summary: str, chat_history: List[Dict], current_question: str) -> str:
    """Create chat prompt with article context and conversation history"""

    # Build conversation history
    history_text = ""
    if chat_history:
        recent_messages = chat_history[-6:]  # Keep last 6 messages for context
        for msg in recent_messages:
            if msg["role"] == "user":
                history_text += f"User: {msg['content']}\n"
            else:
                history_text += f"Assistant: {msg['content']}\n"

    prompt = f"""You are an AI assistant helping users understand and discuss an article. Use the article content below to answer questions accurately and helpfully.

ARTICLE SUMMARY:
{article_summary}

FULL ARTICLE CONTENT:
{article_text[:8000]}...

CONVERSATION HISTORY:
{history_text}

USER'S CURRENT QUESTION: {current_question}

Please provide a helpful, accurate, and conversational response based on the article content. If the question cannot be answered from the article, politely explain that the information is not available in the provided text. Keep your response focused and relevant to the article content."""

    return prompt


async def call_gemini_api(prompt: str, api_key: str) -> str:
    """
    Make async API call to Gemini
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"

    headers = {
        "Content-Type": "application/json"
    }

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1000,
            "topP": 0.8,
            "topK": 40
        },
        "safetySettings": [
            {
                "category": "HARM_CATEGORY_HARASSMENT",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
                "category": "HARM_CATEGORY_HATE_SPEECH",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
                "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
                "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                "threshold": "BLOCK_MEDIUM_AND_ABOVE"
            }
        ]
    }

    timeout = aiohttp.ClientTimeout(total=30)  # 30 second timeout

    async with aiohttp.ClientSession(timeout=timeout) as session:
        try:
            async with session.post(url, json=payload, headers=headers) as response:
                response_text = await response.text()

                if response.status != 200:
                    logger.error(f"Gemini API error {response.status}: {response_text}")

                    try:
                        error_data = await response.json()
                        error_message = error_data.get("error", {}).get("message", "Unknown API error")
                    except:
                        error_message = f"HTTP {response.status}: {response_text}"

                    if response.status == 400:
                        raise Exception(f"Bad request: {error_message}")
                    elif response.status == 403:
                        raise Exception(f"API key invalid or expired: {error_message}")
                    elif response.status == 429:
                        raise Exception(f"Rate limit exceeded: {error_message}")
                    else:
                        raise Exception(f"API error: {error_message}")

                data = await response.json()

                # Extract response from data
                candidates = data.get("candidates", [])
                if not candidates:
                    raise Exception("No response candidates returned from API")

                content = candidates[0].get("content", {})
                parts = content.get("parts", [])

                if not parts:
                    raise Exception("Empty response from API - content may have been blocked by safety filters")

                response_text = parts[0].get("text", "").strip()

                if not response_text:
                    raise Exception("Empty response returned from API")

                return response_text

        except asyncio.TimeoutError:
            raise Exception("Request to Gemini API timed out")
        except aiohttp.ClientError as e:
            raise Exception(f"Network error: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    print("🚀 Starting Enhanced Article Summary and Chat RAG Server...")
    print(f"📡 API Key configured: {'✅ Yes' if GEMINI_API_KEY else '❌ No'}")

    if not GEMINI_API_KEY:
        print("⚠️  Warning: Set GEMINI_API_KEY environment variable before running!")
        print("   Example: export GEMINI_API_KEY='your-api-key-here'")

    print("🌐 Server will be available at: http://127.0.0.1:7860")
    print("📊 Health check: http://127.0.0.1:7860/health")
    print("📝 API docs: http://127.0.0.1:7860/docs")
    print("💬 Features: Article Summarization + Chat")

    uvicorn.run(
        "rag_server:app",
        host="127.0.0.1",
        port=7860,
        reload=True,
        log_level="info"
    )
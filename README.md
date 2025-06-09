#  RAG based AI Summary & Chat for Articles

This project combines a **Chrome Extension** and a **local FastAPI server** to provide real-time AI-powered summarization and chat capabilities for any web article, powered by **Google Gemini** through a **Retrieval-Augmented Generation (RAG)** approach.
---

https://github.com/user-attachments/assets/a0e90be1-5c11-4652-a26f-407f0c2f60c7

---

##  Features

### 🔹 Chrome Extension
- Extracts readable content from any web page.
- Offers 3 types of summaries:
  - Brief
  - Detailed
  - Bullet Points
- Chat with the article content using Gemini AI.
- Local-first: No external servers needed except Gemini API.

### 🔹 FastAPI RAG Server
- Handles summarization and conversational querying of article content.
- Communicates with the Gemini API (requires your API key).
- Built with `FastAPI`, `aiohttp`, and `pydantic`.

---

##  Architecture Overview

```text
Chrome Extension → FastAPI RAG Server → Gemini API
           ↑                              ↓
      Extracted Text                AI Summaries/Answers
```

---

##  Tech Stack

- `FastAPI`, `aiohttp`, `pydantic`
- `Google Gemini API`
- `Chrome Extension APIs (Manifest V3)`
- Frontend: HTML/CSS/JavaScript (Popup & Options UI)

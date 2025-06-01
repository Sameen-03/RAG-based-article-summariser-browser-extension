// Global variables
let currentArticleText = "";
let chatSessionId = null;
let isChatInitialized = false;

// Configuration
const RAG_SERVER_URL = "http://127.0.0.1:7860";

// Initialize the popup
document.addEventListener("DOMContentLoaded", () => {
  setupTabSwitching();
  setupSummaryFunctionality();
  setupChatFunctionality();
  checkServerStatus();
});

// Check if RAG server is running
// Check if RAG server is running
async function checkServerStatus() {
  const apiStatus = document.getElementById("api-status");

  try {
    const response = await fetch(`${RAG_SERVER_URL}/health`);
    const data = await response.json();

    if (response.ok) {
      // Server is running, check if we have API key in storage
      const apiKey = await getStoredApiKey();

      if (apiKey || data.api_key_configured) {
        apiStatus.textContent = " RAG Server & API Ready";
        apiStatus.className = "api-status connected";
      } else {
        apiStatus.textContent = " Server running but API key needed";
        apiStatus.className = "api-status error";
      }
    }
  } catch (error) {
    apiStatus.textContent = " RAG Server not running";
    apiStatus.className = "api-status error";
  }
}
// Tab switching functionality
function setupTabSwitching() {
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      // Remove active class from all tabs and contents
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(content => content.classList.remove("active"));

      // Add active class to clicked tab and corresponding content
      tab.classList.add("active");
      const targetTab = tab.getAttribute("data-tab");
      document.getElementById(`${targetTab}-tab`).classList.add("active");
    });
  });
}

// Summary functionality
function setupSummaryFunctionality() {
  document.getElementById("summarize").addEventListener("click", async () => {
    const resultDiv = document.getElementById("summary-result");
    const summaryType = document.getElementById("summary-type").value;

    // Show loading state
    resultDiv.innerHTML = `
      <div class="loading">
        <div class="loader"></div>
        <div>Generating ${summaryType} summary...</div>
      </div>
    `;

    try {
      // Get article text from current tab
      const articleText = await getArticleText();

      if (!articleText) {
        resultDiv.innerHTML = " Could not extract article text from this page. Please make sure you're on an article page with readable content.";
        return;
      }

      currentArticleText = articleText;

      // Get API key from storage
      const apiKey = await getStoredApiKey();

      // Call RAG server for summarization
      const response = await fetch(`${RAG_SERVER_URL}/summarize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: articleText,
          summary_type: summaryType,
          api_key: apiKey
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();

      // Display the summary
      resultDiv.innerHTML = `
        <div style="color: #2d3748; line-height: 1.6;">
          ${data.summary}
        </div>
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #718096;">
          <strong>Processing time:</strong> ${data.processing_time.toFixed(2)}s |
          <strong>Text length:</strong> ${data.text_length.toLocaleString()} characters
        </div>
      `;

    } catch (error) {
      console.error("Summarization error:", error);
      resultDiv.innerHTML = ` Error: ${error.message}`;
    }
  });

  // Copy summary functionality
  document.getElementById("copy-summary-btn").addEventListener("click", async () => {
    const resultDiv = document.getElementById("summary-result");
    const text = resultDiv.textContent;

    if (text && !text.includes("Select a summary type")) {
      try {
        await navigator.clipboard.writeText(text);

        // Show success feedback
        const originalText = document.getElementById("copy-summary-btn").textContent;
        document.getElementById("copy-summary-btn").textContent = "Copied!";
        setTimeout(() => {
          document.getElementById("copy-summary-btn").textContent = originalText;
        }, 1500);
      } catch (error) {
        console.error("Copy failed:", error);
      }
    }
  });
}

// Chat functionality
function setupChatFunctionality() {
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");
  const chatMessages = document.getElementById("chat-messages");
  const startChatBtn = document.getElementById("start-chat");
  const clearChatBtn = document.getElementById("clear-chat");

  // Start chat functionality
  startChatBtn.addEventListener("click", async () => {
    try {
      // Get article text if not already loaded
      if (!currentArticleText) {
        currentArticleText = await getArticleText();
      }

      if (!currentArticleText) {
        displayChatMessage("system", " Could not extract article text from this page. Please make sure you're on an article page with readable content.");
        return;
      }

      // Clear any existing chat
      chatMessages.innerHTML = "";
      chatSessionId = null;

      // Enable chat input
      chatInput.disabled = false;
      chatSend.disabled = false;
      chatInput.placeholder = "Ask a question about this article...";

      isChatInitialized = true;

      displayChatMessage("system", " Chat initialized! You can now ask questions about this article.");

      // Focus on input
      chatInput.focus();

    } catch (error) {
      console.error("Chat initialization error:", error);
      displayChatMessage("system", ` Error initializing chat: ${error.message}`);
    }
  });

  // Clear chat functionality
  clearChatBtn.addEventListener("click", async () => {
    if (chatSessionId) {
      try {
        await fetch(`${RAG_SERVER_URL}/chat/${chatSessionId}`, {
          method: "DELETE"
        });
      } catch (error) {
        console.error("Error clearing server session:", error);
      }
    }

    chatMessages.innerHTML = '<div class="empty-chat">Click "Start Chat" to begin asking questions about this article.</div>';
    chatInput.disabled = true;
    chatSend.disabled = true;
    chatInput.placeholder = "Ask a question about this article...";
    chatInput.value = "";
    chatSessionId = null;
    isChatInitialized = false;
  });

  // Send message functionality
  async function sendMessage() {
    const question = chatInput.value.trim();

    if (!question || !isChatInitialized) return;

    // Clear input and disable temporarily
    chatInput.value = "";
    chatSend.disabled = true;
    chatInput.disabled = true;

    // Display user message
    displayChatMessage("user", question);

    // Show loading indicator
    const loadingId = displayChatMessage("assistant", "");
    const loadingElement = document.querySelector(`[data-message-id="${loadingId}"]`);
    loadingElement.innerHTML = `
      <div class="loading">
        <div class="loader"></div>
        <div>Thinking...</div>
      </div>
    `;

    try {
      const apiKey = await getStoredApiKey();

      const response = await fetch(`${RAG_SERVER_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          article_text: currentArticleText,
          question: question,
          session_id: chatSessionId,
          api_key: apiKey
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();

      // Update session ID
      chatSessionId = data.session_id;

      // Replace loading message with actual response
      loadingElement.innerHTML = `
        <div class="message assistant">
          <div>${data.answer}</div>
          <div class="message-time">${new Date().toLocaleTimeString()}</div>
        </div>
      `;

    } catch (error) {
      console.error("Chat error:", error);
      loadingElement.innerHTML = `
        <div class="message assistant">
          <div> Error: ${error.message}</div>
          <div class="message-time">${new Date().toLocaleTimeString()}</div>
        </div>
      `;
    } finally {
      // Re-enable input
      chatSend.disabled = false;
      chatInput.disabled = false;
      chatInput.focus();
    }
  }

  // Event listeners for sending messages
  chatSend.addEventListener("click", sendMessage);

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 80) + "px";
  });
}

// Helper function to display chat messages
function displayChatMessage(role, content) {
  const chatMessages = document.getElementById("chat-messages");
  const messageId = Date.now() + Math.random();

  // Remove empty chat message if it exists
  const emptyChat = chatMessages.querySelector(".empty-chat");
  if (emptyChat) {
    emptyChat.remove();
  }

  if (role === "system") {
    const systemMessage = document.createElement("div");
    systemMessage.className = "message assistant";
    systemMessage.innerHTML = `
      <div>${content}</div>
      <div class="message-time">${new Date().toLocaleTimeString()}</div>
    `;
    chatMessages.appendChild(systemMessage);
  } else {
    const messageDiv = document.createElement("div");
    messageDiv.setAttribute("data-message-id", messageId);
    messageDiv.innerHTML = `
      <div class="message ${role}">
        <div>${content}</div>
        <div class="message-time">${new Date().toLocaleTimeString()}</div>
      </div>
    `;
    chatMessages.appendChild(messageDiv);
  }

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return messageId;
}

// Helper function to get article text from current tab
async function getArticleText() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "GET_ARTICLE_TEXT" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Content script error:", chrome.runtime.lastError);
          resolve("");
          return;
        }

        if (response && response.text) {
          resolve(response.text);
        } else if (response && response.error) {
          console.error("Article extraction error:", response.error);
          resolve("");
        } else {
          resolve("");
        }
      });
    });
  });
}

// Helper function to get stored API key
async function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["geminiApiKey"], (result) => {
      resolve(result.geminiApiKey || "");
    });
  });
}
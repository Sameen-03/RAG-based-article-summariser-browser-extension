document.addEventListener("DOMContentLoaded", () => {
  // Load saved API key if it exists
  chrome.storage.sync.get(["geminiApiKey"], (result) => {
    if (result.geminiApiKey) {
      document.getElementById("api-key").value = result.geminiApiKey;
    }
  });

  // Save API key when button is clicked
  document.getElementById("save-button").addEventListener("click", async () => {
    const apiKey = document.getElementById("api-key").value.trim();

    if (!apiKey) {
      alert("Please enter a valid API key");
      return;
    }

    // Validate API key format (basic check)
    if (!apiKey.startsWith("AIza") || apiKey.length < 30) {
      alert("Please enter a valid Gemini API key (should start with 'AIza')");
      return;
    }

    // Test API key with RAG server
    const testButton = document.getElementById("save-button");
    const originalText = testButton.textContent;
    testButton.textContent = "Testing API Key...";
    testButton.disabled = true;

    try {
      // Test the API key by making a simple request to the RAG server
      const response = await fetch("http://127.0.0.1:7860/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "This is a test article to validate the API key functionality.",
          summary_type: "brief",
          api_key: apiKey
        })
      });

      if (response.ok) {
        // API key is valid, save it
        chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
          const successMessage = document.getElementById("success-message");
          successMessage.style.display = "block";

          // Close the tab after a short delay to show the success message
          setTimeout(() => {
            // Try to close the tab
            chrome.tabs.getCurrent((tab) => {
              if (tab && tab.id) {
                chrome.tabs.remove(tab.id);
              } else {
                window.close();
              }
            });
          }, 2000);
        });
      } else {
        const errorData = await response.json();
        throw new Error(errorData.detail || "API key validation failed");
      }

    } catch (error) {
      console.error("API key validation error:", error);

      let errorMessage = "Failed to validate API key. ";

      if (error.message.includes("Failed to fetch")) {
        errorMessage += "Please make sure the RAG server is running on http://127.0.0.1:7860";
      } else if (error.message.includes("403") || error.message.includes("API key invalid")) {
        errorMessage += "The API key appears to be invalid or expired.";
      } else {
        errorMessage += error.message;
      }

      alert(errorMessage);
    } finally {
      testButton.textContent = originalText;
      testButton.disabled = false;
    }
  });

  // Add Enter key support
  document.getElementById("api-key").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      document.getElementById("save-button").click();
    }
  });
});
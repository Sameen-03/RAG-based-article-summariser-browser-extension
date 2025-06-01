function getArticleText() {
  // Try multiple strategies to extract article text
  let text = "";
  let method = "";

  // Strategy 1: Look for article tag
  const article = document.querySelector("article");
  if (article && article.innerText.trim().length > 100) {
    text = article.innerText.trim();
    method = "article tag";
    console.log("Found article tag with text length:", text.length);
    return { text, method };
  }

  // Strategy 2: Look for JSON-LD structured data
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (data.articleBody && data.articleBody.length > 100) {
        text = data.articleBody;
        method = "JSON-LD structured data";
        console.log("Found article content in JSON-LD with length:", text.length);
        return { text, method };
      }
    } catch (e) {
      // Continue to next script
    }
  }

  // Strategy 3: Look for main content areas
  const mainSelectors = [
    'main article',
    'main [role="main"]',
    '[role="main"]',
    'main',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.content-body',
    '.article-body',
    '.story-body',
    '.post-body',
    '.content',
    '#content',
    '.main-content'
  ];

  for (const selector of mainSelectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText.trim().length > 100) {
      text = element.innerText.trim();
      method = `selector: ${selector}`;
      console.log(`Found content using selector "${selector}" with length:`, text.length);
      return { text, method };
    }
  }

  // Strategy 4: Look for specific news/blog patterns
  const newsSelectors = [
    '.article-text',
    '.article-content-body',
    '.post-text',
    '.entry-text',
    '.story-content',
    '.news-content',
    '.blog-content',
    '.content-wrapper',
    '.text-content'
  ];

  for (const selector of newsSelectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText.trim().length > 100) {
      text = element.innerText.trim();
      method = `news selector: ${selector}`;
      console.log(`Found content using news selector "${selector}" with length:`, text.length);
      return { text, method };
    }
  }

  // Strategy 5: Get all paragraphs and filter (fallback)
  const paragraphs = Array.from(document.querySelectorAll("p"));
  if (paragraphs.length > 0) {
    const paragraphText = paragraphs
      .map(p => p.innerText.trim())
      .filter(txt => txt.length > 20) // Filter out very short paragraphs
      .filter(txt => !txt.match(/^(subscribe|follow|share|comment|advertisement)/i)) // Filter common non-content
      .join("\n\n");

    if (paragraphText.length > 100) {
      text = paragraphText;
      method = "paragraph extraction";
      console.log("Using paragraph fallback with length:", text.length);
      return { text, method };
    }
  }

  // Strategy 6: Try to get text from body but filter out navigation/footer content
  const bodyText = document.body.innerText.trim();
  if (bodyText.length > 100) {
    // Simple cleanup - remove common navigation patterns
    const cleanedText = bodyText
      .replace(/^.*?(Home|Menu|Navigation).*?\n/gm, '')
      .replace(/^.*?(Footer|Copyright).*$/gm, '')
      .trim();

    if (cleanedText.length > 100) {
      text = cleanedText;
      method = "body text (cleaned)";
      console.log("Using cleaned body text fallback with length:", text.length);
      return { text, method };
    }
  }

  console.log("No substantial text content found on page");
  return { text: "", method: "none" };
}

function cleanText(text) {
  // Basic text cleaning
  return text
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n\s*\n/g, '\n\n') // Clean up line breaks
    .trim();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);

  if (request.type === "GET_ARTICLE_TEXT") {
    try {
      const result = getArticleText();

      if (!result.text || result.text.length < 50) {
        console.log("Insufficient text content found");
        sendResponse({
          text: "",
          error: "Page doesn't contain enough readable text content",
          method: result.method
        });
        return;
      }

      const cleanedText = cleanText(result.text);

      console.log("Successfully extracted text using method:", result.method);
      console.log("Text length:", cleanedText.length);

      sendResponse({
        text: cleanedText,
        method: result.method,
        length: cleanedText.length
      });

    } catch (error) {
      console.error("Error extracting article text:", error);
      sendResponse({
        text: "",
        error: error.message
      });
    }
  }

  // Return true to indicate we'll send a response asynchronously
  return true;
});
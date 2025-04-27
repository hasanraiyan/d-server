# Pollinations.AI API Documentation

**World's Most Accessible Open GenAI Platform 🚀
Text APIs direct integration (no signup)**

---

## Quickstart

Click the links below to see examples in your browser:

- **Ask ❓:** [`https://text.pollinations.ai/why_you_should_donate_to_pollinations_ai`](https://text.pollinations.ai/why_you_should_donate_to_pollinations_ai)

---

## Summary / Navigation

- [Pollinations.AI API Documentation](#pollinationsai-api-documentation)
  - [Quickstart](#quickstart)
  - [Summary / Navigation](#summary--navigation)
  - [Generate Text API 📝](#generate-text-api-)
    - [Text-To-Text (GET) 🗣️](#text-to-text-get-️)
    - [Text & Multimodal (OpenAI Compatible POST) 🧠💬⚙️](#text--multimodal-openai-compatible-post-️️)
      - [Function Calling ⚙️](#function-calling-️)
    - [List Available Text Models 📜](#list-available-text-models-)
  - [MCP Server for AI Assistants 🤖🔧](#mcp-server-for-ai-assistants-)
  - [React Hooks ⚛️](#react-hooks-️)
  - [Real-time Feeds API 🔄](#real-time-feeds-api-)
    - [Text Feed 📝📈](#text-feed-)
  - [Referrer 🔗](#referrer-)
    - [API Update (starting **2025.03.31**) 📅](#api-update-starting-20250331-)
    - [Special Bee ✅🐝🍯](#special-bee-)
  - [License 📜](#license-)

---

## Generate Text API 📝

### Text-To-Text (GET) 🗣️

`GET https://text.pollinations.ai/{prompt}`

Generates text based on a simple prompt.

**Parameters:**

| Parameter  | Required | Description                                                                                | Options                   | Default  |
| :--------- | :------- | :----------------------------------------------------------------------------------------- | :------------------------ | :------- |
| `prompt`   | Yes      | Text prompt for the AI. Should be URL-encoded.                                             |                           |          |
| `model`    | No       | Model for generation. See [Available Text Models](#list-available-text-models-).           | `openai`, `mistral`, etc. | `openai` |
| `seed`     | No       | Seed for reproducible results.                                                             |                           |          |
| `json`     | No       | Set to `true` to receive the response formatted as a JSON string.                          | `true` / `false`          | `false`  |
| `system`   | No       | System prompt to guide AI behavior. Should be URL-encoded.                                 |                           |          |
| `stream`   | No       | Set to `true` for streaming responses via Server-Sent Events (SSE). Handle `data:` chunks. | `true` / `false`          | `false`  |
| `private`  | No       | Set to `true` to prevent the response from appearing in the public feed.                   | `true` / `false`          | `false`  |
| `referrer` | No\*     | Referrer URL/Identifier. See [Referrer Section](#referrer-).                               |                           |          |

**Return:** Generated text (plain text or JSON string if `json=true`) 📝. If `stream=true`, returns an SSE stream.

**Rate Limit (per IP):** 1 concurrent request / 3 sec interval.



<details>
<summary><strong>Code Examples:</strong> Generate Text (GET)</summary>

**cURL:**

```bash
# Basic prompt
curl "https://text.pollinations.ai/What%20is%20the%20capital%20of%20France%3F"

# With parameters (model, seed, system prompt)
curl "https://text.pollinations.ai/Write%20a%20short%20poem%20about%20robots?model=mistral&seed=123&system=You%20are%20a%20poet"

# Get JSON response
curl "https://text.pollinations.ai/What%20is%20AI?json=true"

# Streaming response (raw SSE output)
curl -N "https://text.pollinations.ai/Tell%20me%20a%20very%20long%20story?stream=true"
```

**Python (`requests`):**

```python
import requests
import urllib.parse
import json

prompt = "Explain the theory of relativity simply"
params = {
    "model": "openai",
    "seed": 42,
    # "json": "true", # Optional: Get response as JSON string
    # "system": "Explain things like I'm five.", # Optional
    # "referrer": "MyPythonApp" # Optional
}
encoded_prompt = urllib.parse.quote(prompt)
encoded_system = urllib.parse.quote(params.get("system", "")) if "system" in params else None

url = f"https://text.pollinations.ai/{encoded_prompt}"
query_params = {k: v for k, v in params.items() if k != "system"} # Remove system from query params if present
if encoded_system:
    query_params["system"] = encoded_system

try:
    response = requests.get(url, params=query_params)
    response.raise_for_status()

    if params.get("json") == "true":
        # The response is a JSON *string*, parse it
        try:
             data = json.loads(response.text)
             print("Response (JSON parsed):", data)
        except json.JSONDecodeError:
             print("Error: API returned invalid JSON string.")
             print("Raw response:", response.text)
    else:
        print("Response (Plain Text):")
        print(response.text)

except requests.exceptions.RequestException as e:
    print(f"Error fetching text: {e}")
```

**JavaScript (Browser `fetch`):**

```javascript
async function fetchText(prompt, params = {}) {
  const queryParams = new URLSearchParams(params);
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://text.pollinations.ai/${encodedPrompt}?${queryParams.toString()}`;

  console.log("Fetching text from:", url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseText = await response.text();

    if (params.json === "true" || params.json === true) {
      try {
        const data = JSON.parse(responseText);
        console.log("Response (JSON parsed):", data);
        // Process JSON data
      } catch (e) {
        console.error("Failed to parse JSON response:", e);
        console.log("Raw response:", responseText);
      }
    } else {
      console.log("Response (Plain Text):", responseText);
      // Display plain text
      // document.getElementById('output').textContent = responseText;
    }
  } catch (error) {
    console.error("Error fetching text:", error);
  }
}

// --- Usage ---
fetchText("What are the main benefits of exercise?");

fetchText("List 3 popular dog breeds", {
  model: "mistral",
  json: "true", // Get result as JSON string
});

// Note: For stream=true, see dedicated streaming example under POST section
```

</details>

---

### Text & Multimodal (OpenAI Compatible POST) 🧠💬⚙️

`POST https://text.pollinations.ai/openai`

Provides an OpenAI-compatible endpoint supporting:

- Chat Completions (Text Generation)
- Function Calling
- Streaming Responses (for Text Generation)

Follows the OpenAI Chat Completions API format for inputs where applicable.

**Request Body (JSON):**

```json
{
  "model": "openai",
  "messages": [
    {
      "role": "user",
      "content": "Explain quantum physics"
    }
  ],
  "stream": false,
  "private": false
}
```

**Common Body Parameters:**

| Parameter                      | Description                                                                                                                                                      | Notes                                                                                                                 |
| :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `messages`                     | An array of message objects (role: `system`, `user`, `assistant`).                                                                  | Required for most tasks.                                                                                              |
| `model`                        | The model identifier. See [Available Text Models](#list-available-text-models-).                                                                                 | Required. e.g., `openai` (Chat/Vision), `openai-large` (Vision), `claude-hybridspace` (Vision). |
| `seed`                         | Seed for reproducible results (Text Generation).                                                                                                                 | Optional.                                                                                                             |
| `stream`                       | If `true`, sends partial message deltas using SSE (Text Generation). Process chunks as per OpenAI streaming docs.                                                | Optional, default `false`.                                                                                            |
| `jsonMode` / `response_format` | Set `response_format={ "type": "json_object" }` to constrain text output to valid JSON. `jsonMode: true` is a legacy alias.                                      | Optional. Check model compatibility.                                                                                  |
| `tools`                        | A list of tools (functions) the model may call (Text Generation). See [OpenAI Function Calling Guide](https://platform.openai.com/docs/guides/function-calling). | Optional.                                                                                                             |
| `tool_choice`                  | Controls how the model uses tools.                                                                                                                               | Optional.                                                                                                             |
| `private`                      | Set to `true` to prevent the response from appearing in the public feed.                                                                                         | Optional, default `false`.                                                                                            |
| `reasoning_effort`             | Sets reasoning effort for `o3-mini` model (Text Generation).                                                                                                     | Optional. Options: `low`, `medium`, `high`.                                                                           |

<details>
<summary><strong>Code Examples:</strong> Basic Chat Completion (POST)</summary>

**cURL:**

```bash
curl https://text.pollinations.ai/openai \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the weather like in Paris today?"}
    ],
    "seed": 42
  }'
```

**Python (`requests`):**

```python
import requests
import json

url = "https://text.pollinations.ai/openai"
payload = {
    "model": "openai", # Or "mistral", etc.
    "messages": [
        {"role": "system", "content": "You are a helpful historian."},
        {"role": "user", "content": "When did the French Revolution start?"}
    ],
    "seed": 101,
    # "private": True, # Optional
    # "referrer": "MyPythonApp" # Optional
}
headers = {
    "Content-Type": "application/json"
}

try:
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    result = response.json()
    print("Assistant:", result['choices'][0]['message']['content'])
    # print(json.dumps(result, indent=2)) # Print full response
except requests.exceptions.RequestException as e:
    print(f"Error making POST request: {e}")
```

**JavaScript (Browser `fetch`):**

```javascript
async function postChatCompletion(messages, options = {}) {
  const url = "https://text.pollinations.ai/openai";
  const payload = {
    model: options.model || "openai",
    messages: messages,
    seed: options.seed,
    private: options.private,
    referrer: options.referrer || "WebApp", // Optional
  };

  console.log("Sending POST request to:", url, payload);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error! status: ${response.status}, message: ${errorText}`
      );
    }

    const result = await response.json();
    console.log("Assistant:", result.choices[0].message.content);
    // console.log("Full response:", result);
    return result; // Return the full response object
  } catch (error) {
    console.error("Error posting chat completion:", error);
  }
}

// --- Usage ---
const chatMessages = [
  { role: "system", content": "You are a travel agent." },
  { "role": "user", "content": "Suggest a 3-day itinerary for Rome." },
];
postChatCompletion(chatMessages, { model": "mistral", "seed": 500 });
```

</details>

<details>
<summary><strong>Code Examples:</strong> Streaming Response (POST)</summary>

**cURL:**

```bash
# Use -N for streaming
curl -N https://text.pollinations.ai/openai \
  -H "Content-Type": "application/json" \
  -d '{
    "model": "openai",
    "messages": [
      {"role": "user", "content": "Write a long poem about the sea."}
    ],
    "stream": true
  }'
```

**Python (`requests` with SSE):**

```python
import requests
import json
import sseclient # pip install sseclient-py

url = "https://text.pollinations.ai/openai"
payload = {
    "model": "openai",
    "messages": [
        {"role": "user", "content": "Tell me a story that unfolds slowly."}
    ],
    "stream": true
}
headers = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
}

try:
    response = requests.post(url, headers=headers, json=payload, stream=True)
    response.raise_for_status()

    client = sseclient.SSEClient(response)
    full_response = ""
    print("Streaming response:")
    for event in client.events():
        if event.data:
            try:
                # Handle potential '[DONE]' marker
                if event.data.strip() == '[DONE]':
                     print("\nStream finished.")
                     break
                chunk = json.loads(event.data)
                content = chunk.get('choices', [{}])[0].get('delta', {}).get('content')
                if content:
                    print(content, end='', flush=True)
                    full_response += content
            except json.JSONDecodeError:
                 print(f"\nReceived non-JSON data (or marker other than [DONE]): {event.data}")

    print("\n--- End of Stream ---")
    # print("Full streamed response:", full_response)

except requests.exceptions.RequestException as e:
    print(f"\nError during streaming request: {e}")
except Exception as e:
    print(f"\nError processing stream: {e}")

```

**JavaScript (Browser `fetch` with `ReadableStream`):**

```javascript
async function streamChatCompletion(messages, options = {}, onChunkReceived) {
  const url = "https://text.pollinations.ai/openai";
  const payload = {
    "model": options.model || "openai",
    "messages": messages,
    "seed": options.seed,
    "stream": true, // Enable streaming
  };

  try {
    const response = await fetch(url, {
      method": "POST",
      "headers": {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      "body": JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error! status: ${response.status}, message: ${errorText}`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    console.log("Starting stream...");

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Stream finished.");
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process buffer line by line (SSE format: data: {...}\n\n)
      const lines = buffer.split("\n\n");
      buffer = lines.pop(); // Keep the potentially incomplete last line

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.substring(6).trim();
          if (dataStr === "[DONE]") {
            console.log("Received [DONE] marker.");
            continue; // Or handle end of stream signal
          }
          try {
            const chunk = JSON.parse(dataStr);
            const content = chunk?.choices?.[0]?.delta?.content;
            if (content && onChunkReceived) {
              onChunkReceived(content); // Callback to handle the text chunk
            }
          } catch (e) {
            console.error("Failed to parse stream chunk:", dataStr, e);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error during streaming chat completion:", error);
  }
}

// --- Usage ---
const streamMessages = [
  { role": "user", "content": "Write a detailed explanation of photosynthesis." },
];

// Example callback to display chunks in a div
const outputDiv = document.createElement("div");
document.body.appendChild(outputDiv);
function handleChunk(textChunk) {
  console.log("Chunk:", textChunk);
  outputDiv.textContent += textChunk;
}

streamChatCompletion(streamMessages, { model": "openai" }, handleChunk);
```

</details>

---

#### Function Calling ⚙️

- **Models:** Check compatibility (e.g., `openai` models often support this).
- **How:** Define available functions in the `tools` parameter. The model may respond with a `tool_calls` object in the JSON response, which your code needs to handle.
- **Details:** See [OpenAI Function Calling Guide](https://platform.openai.com/docs/guides/function-calling).
- **Return:** Standard OpenAI chat completion JSON response, potentially including `tool_calls`.

<details>
<summary><strong>Code Examples:</strong> Function Calling (Conceptual)</summary>

**Note:** These examples show defining tools and interpreting the model's request to call a function. You need to implement the actual function execution (`get_current_weather` in this case) separately.

**cURL (Defining Tools):**

```bash
curl https://text.pollinations.ai/openai \
  -H "Content-Type": "application/json" \
  -d '{
    "model": "openai",
    "messages": [{"role": "user", "content": "What is the weather like in Boston?"}],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_current_weather",
          "description": "Get the current weather in a given location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "The city and state, e.g. San Francisco, CA"
              },
              "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["location"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
# Expected Response might include:
# ... "choices": [ { "message": { "role": "assistant", "tool_calls": [ { ... "function": { "name": "get_current_weather", "arguments": "{\"location": \"Boston, MA\"}" ... } ] } } ] ...
```

**Python (`requests` - Setup and Response Handling):**

```python
import requests
import json

url = "https://text.pollinations.ai/openai"
headers = {"Content-Type": "application/json"}

messages = [{"role": "user", "content": "What's the weather in Tokyo?"}]
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "The city and state, e.g. San Francisco, CA"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"], "default": "celsius"}
                },
                "required": ["location"]
            }
        }
    }
]

payload = {
    "model": "openai", # Model must support function calling
    "messages": messages,
    "tools": tools,
    "tool_choice": "auto" # Or {"type": "function", "function": {"name": "get_current_weather"}} to force
}

def execute_get_current_weather(location, unit="celsius"):
    # --- THIS IS YOUR FUNCTION IMPLEMENTATION ---
    # In a real app, call a weather API here based on location/unit
    print(f"--- Executing get_current_weather(location='{location}', unit='{unit}') ---")
    # Dummy response
    if "tokyo" in location.lower():
        return json.dumps({"location": location, "temperature": "15", "unit": unit, "description": "Cloudy"})
    else:
        return json.dumps({"location": location, "temperature": "unknown"})
    # --- END OF YOUR IMPLEMENTATION ---

try:
    print("--- First API Call (User Request) ---")
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    response_data = response.json()
    print(json.dumps(response_data, indent=2))

    response_message = response_data['choices'][0]['message']

    # Check if the model wants to call a tool
    if response_message.get("tool_calls"):
        print("\n--- Model requested tool call ---")
        tool_call = response_message["tool_calls"][0] # Assuming one call for simplicity
        function_name = tool_call["function"]["name"]
        function_args = json.loads(tool_call["function"]["arguments"])

        if function_name == "get_current_weather":
            # Call your actual function
            function_response = execute_get_current_weather(
                location=function_args.get("location"),
                unit=function_args.get("unit", "celsius") # Handle default
            )

            # Append the assistant's request and your function's response to messages
            messages.append(response_message) # Add assistant's msg with tool_calls
            messages.append(
                {
                    "tool_call_id": tool_call["id"],
                    "role": "tool",
                    "name": function_name,
                    "content": function_response, # Result from your function
                }
            )

            # --- Second API Call (With Function Result) ---
            print("\n--- Second API Call (Sending function result) ---")
            second_payload = {
                 "model": "openai",
                 "messages": messages # Send updated message history
            }
            second_response = requests.post(url, headers=headers, json=second_payload)
            second_response.raise_for_status()
            final_result = second_response.json()
            print("\n--- Final Response from Model ---")
            print(json.dumps(final_result, indent=2))
            print("\nFinal Assistant Message:", final_result['choices'][0]['message']['content'])

        else:
            print(f"Error: Model requested unknown function '{function_name}'")

    else:
        print("\n--- Model responded directly ---")
        print("Assistant:", response_message['content'])


except requests.exceptions.RequestException as e:
    print(f"Error during function calling request: {e}")
    # if response is not None: print(response.text)
except Exception as e:
     print(f"An error occurred: {e}")
```

</details>

---

**General Return Format (POST /openai for Text/Functions):**

- OpenAI-style chat completion response object (JSON). 🤖

**Rate Limits:** (Inherits base text API limits, potentially subject to specific model constraints)

---

### List Available Text Models 📜

`GET https://text.pollinations.ai/models`

**Description:** Returns a list of available models for the Text Generation API, including those supporting specific features.

**Return:** JSON list/object containing model identifiers and details.

<details>
<summary><strong>Code Examples:</strong> List Text Models</summary>

**cURL:**

```bash
curl https://text.pollinations.ai/models
```

**Python (`requests`):**

```python
import requests
import json

url = "https://text.pollinations.ai/models"

try:
    response = requests.get(url)
    response.raise_for_status()
    models_data = response.json() # Might be a dict or list, check format
    print("Available Text Models:")
    print(json.dumps(models_data, indent=2))

except requests.exceptions.RequestException as e:
    print(f"Error fetching text models: {e}")
```

**JavaScript (Browser `fetch`):**

```javascript
async function listTextModels() {
  const url = "https://text.pollinations.ai/models";
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const modelsData = await response.json();
    console.log("Available Text Models:", modelsData);
  } catch (error) {
    console.error("Error fetching text models:", error);
  }
}

listTextModels();
```

</details>

---

## MCP Server for AI Assistants 🤖🔧

Pollinations provides an MCP (Model Context Protocol) server that enables AI assistants (like Claude via Anthropics' tool use feature) to generate text responses directly.

- **Server Name:** `pollinations-multimodal-api`
- **Text Tools:**
  - `listTextModels`: List available text generation models.
- **General Tools:**
  - `listModels`: List all available models (can filter by type).

For installation and usage instructions, see the [MCP Server Documentation](./model-context-protocol/README.md) (Link placeholder - requires actual link).
_(Code examples are specific to MCP client implementations and are best suited for the dedicated MCP documentation.)_

---

## React Hooks ⚛️

Integrate Pollinations directly into your React applications.

`npm install @pollinations/react`

- **`usePollinationsText(prompt, options)`**
  - Options: `seed`, `model`, `systemPrompt`
  - Return: `string | null` (Generated text or null)
- **`usePollinationsChat(initialMessages, options)`**
  - Options: `seed`, `jsonMode`, `model` (uses `POST /openai`)
  - Return: `{ sendUserMessage: (message) => void, messages: Array<{role, content}> }`

**Docs:**
- [README](https://github.com/pollinations/pollinations/blob/master/pollinations-react/README.md)
- [PLAYGROUND](https://react-hooks.pollinations.ai/)


---

## Real-time Feeds API 🔄

### Text Feed 📝📈

`GET https://text.pollinations.ai/feed`

**Description:** Server-Sent Events (SSE) stream of publicly generated text responses.

**Example Event Data:**

```json
{
  "response": "Cherry Blossom Pink represents gentleness, kindness, and the transient nature of life. It symbolizes spring, renewal, and the beauty of impermanence in Japanese culture.",
  "model": "openai",
  "messages": [
    {
      "role": "user",
      "content": "What does the color cherry blossom pink represent?"
    }
  ]
}
```

<details>
<summary><strong>Code Examples:</strong> Text Feed (SSE)</summary>

**cURL:**

```bash
# Display raw SSE stream
curl -N https://text.pollinations.ai/feed
```

**JavaScript (Browser `EventSource`):**

```javascript
function connectTextFeed() {
  const feedUrl = "https://text.pollinations.ai/feed";
  console.log("Connecting to Text Feed:", feedUrl);

  const eventSource = new EventSource(feedUrl);

  eventSource.onmessage = function (event) {
    try {
      const textData = JSON.parse(event.data);
      console.log("New Text Response:", textData);
      // Example: Display the response text
      // const p = document.createElement('p');
      // p.textContent = `[${textData.model || 'N/A'}] ${textData.response || 'N/A'}`;
      // document.getElementById('text-feed-output').prepend(p); // Add to your display area
    } catch (e) {
      console.error("Failed to parse text feed data:", event.data, e);
    }
  };

  eventSource.onerror = function (err) {
    console.error("Text Feed Error:", err);
    eventSource.close();
    // setTimeout(connectTextFeed, 5000); // Optional: Attempt reconnect
  };

  eventSource.onopen = function () {
    console.log("Text Feed connection opened.");
  };
}

// --- Usage ---
// connectTextFeed();
```

**Python (`sseclient-py`):**

```python
import sseclient # pip install sseclient-py
import requests
import json
import time

feed_url = "https://text.pollinations.ai/feed"

def connect_text_feed():
     while True:
        try:
            print(f"Connecting to text feed: {feed_url}")
            response = requests.get(feed_url, stream=True, headers={'Accept': 'text/event-stream'})
            response.raise_for_status()
            client = sseclient.SSEClient(response)

            print("Connection established. Waiting for text...")
            for event in client.events():
                 if event.data:
                     try:
                         text_data = json.loads(event.data)
                         print("\n--- New Text ---")
                         print(f"  Model: {text_data.get('model', 'N/A')}")
                         # Truncate long responses for cleaner logging
                         response_preview = (text_data.get('response', 'N/A') or "")[:150]
                         if len(text_data.get('response', '')) > 150: response_preview += "..."
                         print(f"  Response: {response_preview}")
                         # Process text_data as needed
                     except json.JSONDecodeError:
                         print(f"\nReceived non-JSON data: {event.data}")

        except requests.exceptions.RequestException as e:
            print(f"\nConnection error: {e}. Reconnecting in 10 seconds...")
            time.sleep(10)
        except KeyboardInterrupt:
             print("\nInterrupted by user. Exiting.")
             break
        except Exception as e:
             print(f"\nAn unexpected error occurred: {e}. Reconnecting in 10 seconds...")
             time.sleep(10)

# --- Usage ---
# connect_text_feed()
```

</details>

---

## Referrer 🔗

### API Update (starting **2025.03.31**) 📅

- **Text-To-Text** responses may include a link to pollinations.ai 🔗.

**To potentially influence future default behavior or qualify for different rate limits:** Add a `referrer` parameter to your API requests.

- **Web Apps:** Browsers typically send this via the `Referer` HTTP header automatically. Explicitly setting the `referrer` parameter can provide more specific context (e.g., `?referrer=MyWebAppSection`).
- **Bots & Backend Apps:** Add the `referrer` parameter (e.g., `?referrer=MyCoolBot` or in POST body) to identify your application.

### Special Bee ✅🐝🍯

Projects can **request to have their referrer verified** for potentially enhanced API access (e.g., priority queue, modified rate limits). This is evaluated on a case-by-case basis. [Submit a Special Bee Request](https://github.com/pollinations/pollinations/issues/new?template=special-bee-request.yml)

---

## License 📜

Pollinations.AI is open-source software licensed under the [MIT license](LICENSE).

---

Made with ❤️ by the Pollinations.AI team 💡

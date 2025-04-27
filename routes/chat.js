// FILE: hasanraiyan-d-server/routes/chat.js (Updated)
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Chat = require('../models/Chat'); // Ensure this path is correct
const auth = require('../middleware/auth'); // Ensure this path is correct
const axios = require('axios');
const Joi = require('joi');
const validate = require('../middleware/validate'); // Ensure this path is correct
const Task = require('../models/Task'); // Ensure this path is correct
const MoodLog = require('../models/MoodLog'); // Ensure this path is correct
const logger = require('../logger'); // Ensure this path is correct

// --- Tool Definitions (OpenAI Standard - Including all original tools) ---
const aiTools = [
  // Mood Tools
  {
    type: "function",
    function: {
      name: 'log_mood',
      description: 'Log a mood entry for the current user',
      parameters: {
        type: 'object',
        properties: {
          mood: { type: 'integer', description: 'Mood value from 1 (very negative) to 10 (very positive)' },
          note: { type: 'string', description: 'Optional short note about the mood or context' }
        },
        required: ['mood']
      }
    }
  },
  {
    type: "function",
    function: {
      name: 'get_mood_history',
      description: 'Get the recent mood log history for the current user',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', description: 'Optional number of past days to retrieve history for (default: 30)' }
        },
        required: []
      }
    }
  },
  // Task/Planner Tools
  {
    type: "function",
    function: {
      name: 'create_task',
      description: 'Create a planner task for the current user',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Required title of the task' },
          description: { type: 'string', description: 'Optional detailed description of the task' },
          dueDate: { type: 'string', description: 'Optional due date (accepts YYYY-MM-DD or natural language like "tomorrow evening")' }
        },
        required: ['title']
      }
    }
  },
  {
    type: "function",
    function: {
      name: 'get_tasks',
      description: 'Get a list of planner tasks for the current user',
      parameters: {
        type: 'object',
        properties: {
          completed: { type: 'boolean', description: 'Optional filter: true to get completed tasks, false for incomplete (default: lists all)' }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: 'update_task',
      description: 'Update an existing planner task for the current user by its title or ID',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'The title or MongoDB ID of the task to update' },
          newTitle: { type: 'string', description: 'Optional new title for the task' },
          newDescription: { type: 'string', description: 'Optional new description' },
          newDueDate: { type: 'string', description: 'Optional new due date (YYYY-MM-DD or natural language)' },
          markCompleted: { type: 'boolean', description: 'Optional: set to true to mark the task as completed, false to mark as incomplete' }
        },
        required: ['identifier'] // Need at least one field to update, but identifier is key
      }
    }
  },
  {
    type: "function",
    function: {
      name: 'delete_task',
      description: 'Delete a planner task for the current user by its title or ID',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'The title or MongoDB ID of the task to delete' }
        },
        required: ['identifier']
      }
    }
  },
  // Chat Session Tools
  {
    type: "function",
    function: {
      name: 'get_session_summary',
      description: 'Get a summary of the current chat session based on its ID',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'The ID of the current chat session (usually available implicitly)' }
        },
        required: ['sessionId'] // Require sessionId to be sure
      }
    }
  },
  // Feedback Tools
  {
    type: "function",
    function: {
      name: 'give_feedback',
      description: 'Submit feedback (rating 1-5) for a specific AI message in the current chat session',
      parameters: {
        type: 'object',
        properties: {
          // sessionId: { type: 'string', description: 'The ID of the current chat session' }, // Implicitly current session
          messageIndex: { type: 'integer', description: 'The 0-based index of the AI message (from the recent history) to rate' },
          rating: { type: 'integer', description: 'Feedback rating (1-5, where 5 is best)' }
        },
        required: ['messageIndex', 'rating']
      }
    }
  }
];
// --- End Tool Definitions ---

// --- Validation Schemas ---
const chatSchema = Joi.object({
  message: Joi.string().trim().min(1).required(),
  sessionId: Joi.string().required(),
  type: Joi.string().valid('text', 'image').default('text'), // Keep validation for type
  imageUrl: Joi.string().uri().when('type', { is: 'image', then: Joi.optional(), otherwise: Joi.optional() }) // Allow optional imageUrl
});

const feedbackSchema = Joi.object({
  messageIndex: Joi.number().integer().min(0).required(),
  feedback: Joi.number().integer().min(1).max(5).required()
});

const saveTaskSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().allow('').optional(),
  dueDate: Joi.date().iso().optional()
});

const renameSchema = Joi.object({
  title: Joi.string().trim().min(1).required()
});
// --- End Validation Schemas ---


// --- Main Chat POST endpoint with Pollinations/OpenAI Integration & Tool Calling ---
router.post('/', auth, validate(chatSchema), async (req, res) => {
  const { message, sessionId, type, imageUrl } = req.body; // type/imageUrl might be undefined if not sent
  const userId = req.userId;
  const requestId = req.id; // Assuming request ID middleware is used

  logger.info(`[${requestId}] [Chat ${sessionId}] POST /api/chat started`, { userId, type: type || 'text' }); // Log received type or default

  try {
    let chat = await Chat.findOne({ user: userId, sessionId });

    if (!chat) {
      logger.info(`[${requestId}] [Chat ${sessionId}] Creating new chat session`, { userId });
      chat = new Chat({ user: userId, sessionId, messages: [] });
      // Optionally add an initial system message if desired
      // chat.messages.push({ sender: 'system', message: 'Chat session started.', type: 'system', timestamp: new Date() });
    }

    // --- 1. Prepare context for AI (OpenAI Format) ---
    const CONTEXT_LIMIT = 10; // How many *past* messages to send
    const history = chat.messages.slice(-CONTEXT_LIMIT).map(m => {
      // Map database message format to OpenAI message format
      if (m.sender === 'user') {
        let content = [{ type: 'text', text: m.message || "" }]; // Ensure text content is always present
        if (m.type === 'image' && m.imageUrl) {
          content.push({ type: 'image_url', image_url: { url: m.imageUrl } });
        }
        return { role: 'user', content: content };
      } else if (m.sender === 'ai') {
        if (m.tool_calls && m.tool_calls.length > 0) {
          // If the AI message contained tool calls
          return {
            role: 'assistant',
            content: m.message, // Content might be null or text accompanying the tool call
            tool_calls: m.tool_calls.map(tc => ({ // Map to OpenAI format
              id: tc.id,
              type: tc.type || 'function', // Default type if missing
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments // Arguments should be a JSON string
              }
            })).filter(tc => tc.id && tc.function?.name && tc.function?.arguments !== undefined) // Basic validation
          };
        } else {
          // Regular AI text message
          return { role: 'assistant', content: m.message };
        }
      } else if (m.sender === 'tool') {
        // Result of a tool call
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id,
          name: m.tool_name,
          content: m.toolResultData ? JSON.stringify(m.toolResultData) : (m.message || '{"success":false, "error":"Missing tool result data"}') // Send structured data back, handle missing data
        };
      }
      logger.warn(`[${requestId}] [Chat ${sessionId}] Skipping message with unknown sender type in history mapping: ${m.sender}`);
      return null;
    }).filter(m => m !== null); // Filter out any skipped messages

    // Add current user message to the history being sent
    let currentUserMessageContent = [{ type: 'text', text: message }];
    if (type === 'image' && imageUrl) {
      currentUserMessageContent.push({ type: 'image_url', image_url: { url: imageUrl } });
    }
    history.push({ role: 'user', content: currentUserMessageContent });

    // --- 2. Save User Message to DB ---
    const userMessageToSave = {
      sender: 'user',
      message: message, // The text part
      type: type || 'text', // Default to text if not provided
      imageUrl: (type === 'image' && imageUrl) ? imageUrl : undefined,
      timestamp: new Date()
      // Ensure this object structure matches your MessageSchema in models/Chat.js
    };
    chat.messages.push(userMessageToSave);
    chat.lastActivity = new Date();

    // Optional Savepoint: Save user message immediately before calling AI
    // try {
    //   await chat.save();
    //   logger.info(`[${requestId}] [Chat ${sessionId}] User message saved before AI call.`);
    // } catch (preSaveErr) {
    //    logger.error(`[${requestId}] [Chat ${sessionId}] Error saving user message before AI call`, { error: preSaveErr.message, stack: preSaveErr.stack });
    //    // Decide if you should stop here or try calling AI anyway
    //    return res.status(500).json({ message: 'Failed to save your message before contacting AI.' });
    // }

    // --- 3. First API Call to Pollinations/OpenAI ---
    const aiApiUrl = process.env.AI_API_URL || 'https://text.pollinations.ai/openai'; // Fallback URL
    const aiModel = process.env.AI_MODEL || 'openai'; // Or a specific model like 'gpt-4o'
    const apiPayload = {
      model: aiModel,
      messages: history, // The mapped history + current message
      tools: aiTools.length > 0 ? aiTools : undefined,
      tool_choice: aiTools.length > 0 ? "auto" : undefined,
      // Optional parameters:
      // temperature: 0.7,
      // max_tokens: 1000,
      referrer: process.env.POLLINATIONS_REFERRER || "DostifyApp-Backend" // If using Pollinations specifically
    };

    logger.info(`[${requestId}] [Chat ${sessionId}] Calling AI API (Initial)`, { url: aiApiUrl, model: apiPayload.model });
    let aiApiResponse;
    try {
      // Use a longer timeout for potentially complex AI responses or tool calls
      aiApiResponse = await axios.post(aiApiUrl, apiPayload, {
          timeout: 120000, // 120 seconds timeout
          headers: {
              // Add Authorization header if Pollinations requires an API key directly
              // 'Authorization': `Bearer ${process.env.AI_API_KEY}` // Example if needed
          }
      });
      logger.info(`[${requestId}] [Chat ${sessionId}] AI API (Initial) response status: ${aiApiResponse.status}`);
    } catch (apiError) {
      const errorDetails = apiError.response ? { status: apiError.response.status, data: apiError.response.data } : { message: apiError.message };
      logger.error(`[${requestId}] [Chat ${sessionId}] AI API Error (Initial Call)`, { error: errorDetails });
      // Save the user message even if AI fails (if not saved earlier)
      try { await chat.save(); } catch (saveErr) { logger.error(`[${requestId}] [Chat ${sessionId}] Failed to save user message after AI error`, { saveError: saveErr.message }); }
      // Provide a user-friendly error message
      return res.status(502).json({ message: 'Error: The AI service failed to respond. Please try again later.' });
    }

    // --- 4. Process API Response ---
    if (!aiApiResponse.data?.choices?.[0]?.message) { // Check structure carefully based on OpenAI spec
      logger.error(`[${requestId}] [Chat ${sessionId}] Invalid response structure from AI`, { responseData: aiApiResponse.data });
      try { await chat.save(); } catch (saveErr) { logger.error(`[${requestId}] [Chat ${sessionId}] Failed to save user message after invalid AI response`, { saveError: saveErr.message }); }
      return res.status(502).json({ message: 'Error: Received an unexpected response format from the AI service.' });
    }

    const responseChoice = aiApiResponse.data.choices[0];
    const responseMessage = responseChoice.message; // This is the {role: 'assistant', content: '...', tool_calls: [...]} object
    let finalAiMessageContent = responseMessage.content; // This might be null if only tool_calls are present
    let toolResultsForClient = []; // To inform the client what actions were taken

    // --- 5. Handle Tool Calls ---
    // Check if the response contains tool calls and the reason indicates tools should be called
    if (responseMessage.tool_calls && responseChoice.finish_reason === 'tool_calls') {
      logger.info(`[${requestId}] [Chat ${sessionId}] AI requested tool calls`, { count: responseMessage.tool_calls.length, calls: responseMessage.tool_calls.map(t => t.function?.name) });

      // --- 5a. Save AI's Tool Call Request Message ---
      const assistantToolCallRequestMessage = {
        sender: 'ai',
        message: responseMessage.content, // May be null or contain text like "Okay, I can do that."
        type: 'tool_request', // Indicate this is the AI's request
        tool_calls: responseMessage.tool_calls.map(tc => ({ // Store tool call details structurally based on MessageSchema
          id: tc.id,
          type: tc.type, // e.g., 'function'
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments // Store the raw arguments JSON string
          }
        })),
        timestamp: new Date()
      };
      chat.messages.push(assistantToolCallRequestMessage);

      // Prepare history for the follow-up call (includes user msg, AI request)
      const followUpHistory = [...history, responseMessage]; // Add the assistant's message object itself
      let executedToolResults = []; // Store results to send back to AI

      // --- 5b. Execute Tool Calls Sequentially ---
      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type !== 'function') {
            logger.warn(`[${requestId}] [Chat ${sessionId}] Skipping non-function tool call type: ${toolCall.type}`);
            continue;
        }

        const functionName = toolCall.function.name;
        const toolCallId = toolCall.id;
        let functionArgs;
        try {
          // **Crucially parse arguments string here**
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          logger.error(`[${requestId}] [Chat ${sessionId}] Failed to parse tool arguments for ${functionName}`, { argsString: toolCall.function.arguments, error: parseError.message });
          const errorResult = { success: false, error: `Invalid arguments format received from AI for ${functionName}.` };
          executedToolResults.push({ tool_call_id: toolCallId, name: functionName, result: errorResult });
          // Save the error result message to DB
          chat.messages.push({
            sender: 'tool',
            message: `Error executing tool '${functionName}': Invalid arguments provided by AI.`, // User-friendly summary
            type: 'tool_result',
            tool_call_id: toolCallId,
            tool_name: functionName,
            toolResultData: errorResult, // Store the detailed error
            timestamp: new Date()
          });
          toolResultsForClient.push(errorResult); // Inform client
          continue; // Skip to next tool call if arguments are invalid
        }

        let currentToolResult = null;
        logger.info(`[${requestId}] [Chat ${sessionId}] Executing tool: ${functionName}`, { toolCallId, args: functionArgs });

        try {
          // --- Tool Execution Logic (Switch or If/Else based on functionName) ---
          switch (functionName) {
              case 'log_mood':
                  const moodValue = parseInt(functionArgs.mood);
                  if (isNaN(moodValue) || moodValue < 1 || moodValue > 10) throw new Error("Mood value must be an integer between 1 and 10.");
                  const moodDoc = new MoodLog({ user: userId, mood: moodValue, note: functionArgs.note });
                  await moodDoc.save();
                  currentToolResult = { success: true, message: `Mood (${moodValue}) logged successfully.` };
                  break;

              case 'create_task':
                  let parsedDueDate;
                  if (functionArgs.dueDate) {
                     try {
                       // Basic date parsing, consider library for robust parsing
                       if (typeof functionArgs.dueDate === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(functionArgs.dueDate)) {
                          logger.warn(`[${requestId}] [Chat ${sessionId}] Potentially non-ISO date for create_task: "${functionArgs.dueDate}". Attempting generic parse.`);
                       }
                       parsedDueDate = new Date(functionArgs.dueDate);
                       if (isNaN(parsedDueDate.getTime())) throw new Error('Invalid date format provided by AI.');
                     } catch (dateError) {
                       logger.warn(`[${requestId}] [Chat ${sessionId}] Error parsing date for create_task: "${functionArgs.dueDate}". Task created without due date.`, { error: dateError.message });
                       parsedDueDate = undefined; // Fallback: create task without date
                     }
                   }
                   const taskDoc = new Task({ user: userId, title: functionArgs.title, description: functionArgs.description, dueDate: parsedDueDate });
                   await taskDoc.save();
                   let taskMessage = `Task "${functionArgs.title}" created successfully.`;
                   if (parsedDueDate) taskMessage += ` Due: ${parsedDueDate.toLocaleDateString()}`;
                   currentToolResult = { success: true, message: taskMessage, taskId: taskDoc._id.toString() };
                   break;

              case 'get_tasks':
                  const filter = { user: userId };
                  if (typeof functionArgs.completed === 'boolean') filter.completed = functionArgs.completed;
                  const tasks = await Task.find(filter).select('title description dueDate completed _id').sort({ dueDate: 1, createdAt: -1 }).limit(25);
                  if (tasks.length === 0) {
                     currentToolResult = { success: true, message: "No tasks found matching the criteria." };
                  } else {
                     currentToolResult = { success: true, tasks: tasks.map(t => ({ id: t._id.toString(), title: t.title, description: t.description || 'N/A', dueDate: t.dueDate?.toISOString().split('T')[0] || 'N/A', completed: t.completed })) };
                  }
                  break;

              case 'get_mood_history':
                   const days = parseInt(functionArgs.days) || 30;
                   if (isNaN(days) || days <= 0) throw new Error("Number of days must be a positive integer.");
                   const sinceDate = new Date();
                   sinceDate.setDate(sinceDate.getDate() - days);
                   const moods = await MoodLog.find({ user: userId, createdAt: { $gte: sinceDate } }).select('mood note createdAt').sort({ createdAt: -1 }).limit(50);
                   if (moods.length === 0) {
                     currentToolResult = { success: true, message: `No mood logs found in the last ${days} days.` };
                   } else {
                      currentToolResult = { success: true, moods: moods.map(m => ({ mood: m.mood, note: m.note || 'N/A', date: m.createdAt.toISOString().split('T')[0] })) };
                   }
                   break;

              case 'update_task':
                   const { identifier, newTitle, newDescription, newDueDate, markCompleted } = functionArgs;
                   if (!identifier) throw new Error("Task identifier (title or ID) is required for update.");
                   const query = mongoose.Types.ObjectId.isValid(identifier)
                     ? { _id: new mongoose.Types.ObjectId(identifier), user: userId }
                     : { title: identifier, user: userId };
                   const updateFields = { $set: {} };
                   let changesMade = false;
                   if (newTitle) { updateFields.$set.title = newTitle; changesMade = true; }
                   if (newDescription !== undefined) { updateFields.$set.description = newDescription; changesMade = true; }
                   if (markCompleted !== undefined) { updateFields.$set.completed = markCompleted; changesMade = true; }
                   if (newDueDate) {
                     try {
                       const parsedDate = new Date(newDueDate);
                       if (isNaN(parsedDate.getTime())) throw new Error('Invalid date format for newDueDate.');
                       updateFields.$set.dueDate = parsedDate;
                       changesMade = true;
                     } catch (dateError) {
                       logger.warn(`[${requestId}] [Chat ${sessionId}] Invalid date for update_task: "${newDueDate}". Date not updated.`, { error: dateError.message });
                     }
                   }
                   if (!changesMade) {
                     currentToolResult = { success: false, message: "No changes provided for the task update." };
                   } else {
                     const updatedTask = await Task.findOneAndUpdate(query, updateFields, { new: true });
                     if (!updatedTask) {
                       currentToolResult = { success: false, error: `Task with identifier "${identifier}" not found or access denied.` };
                     } else {
                       currentToolResult = { success: true, message: `Task "${updatedTask.title}" updated successfully.` };
                     }
                   }
                   break;

              case 'delete_task':
                  const { identifier: deleteIdentifier } = functionArgs; // Rename to avoid conflict
                  if (!deleteIdentifier) throw new Error("Task identifier (title or ID) is required for deletion.");
                  const deleteQuery = mongoose.Types.ObjectId.isValid(deleteIdentifier)
                    ? { _id: new mongoose.Types.ObjectId(deleteIdentifier), user: userId }
                    : { title: deleteIdentifier, user: userId };
                  const deletedTask = await Task.findOneAndDelete(deleteQuery);
                  if (!deletedTask) {
                    currentToolResult = { success: false, error: `Task with identifier "${deleteIdentifier}" not found or access denied.` };
                  } else {
                    currentToolResult = { success: true, message: `Task "${deletedTask.title}" deleted successfully.` };
                  }
                  break;

              case 'get_session_summary':
                  const summary = {
                    sessionId: chat.sessionId,
                    title: chat.title || `Chat started on ${new Date(chat.createdAt).toLocaleDateString()}`,
                    createdAt: chat.createdAt.toISOString(),
                    lastActivity: chat.lastActivity.toISOString(),
                    messageCount: chat.messages.length,
                    firstUserMessage: chat.messages.find(m => m.sender === 'user')?.message?.substring(0, 100) || null
                  };
                  currentToolResult = { success: true, summary: summary };
                  break;

              case 'give_feedback':
                  const { messageIndex, rating } = functionArgs;
                  if (messageIndex < 0 || messageIndex >= chat.messages.length) {
                     throw new Error(`Invalid message index ${messageIndex}. Session has ${chat.messages.length} messages.`);
                  }
                  const targetMessage = chat.messages[messageIndex];
                  if (!targetMessage || targetMessage.sender !== 'ai') {
                     throw new Error("Feedback can only be given for AI messages at the specified index.");
                  }
                  if (isNaN(parseInt(rating)) || rating < 1 || rating > 5) {
                     throw new Error("Rating must be an integer between 1 and 5.");
                  }
                  targetMessage.feedback = rating;
                  chat.markModified('messages'); // IMPORTANT: Tell Mongoose the array element changed
                  currentToolResult = { success: true, message: `Feedback (${rating}) recorded for message at index ${messageIndex}.` };
                  break;

              default:
                  logger.warn(`[${requestId}] [Chat ${sessionId}] Unknown tool called: ${functionName}`);
                  currentToolResult = { success: false, error: `Tool '${functionName}' is not implemented or recognized.` };
          }
          // --- End Tool Implementations ---
          logger.info(`[${requestId}] [Chat ${sessionId}] Tool ${functionName} executed`, { toolCallId, success: currentToolResult?.success });

        } catch (toolError) {
          logger.error(`[${requestId}] [Chat ${sessionId}] Error executing tool ${functionName}`, { toolCallId, args: functionArgs, error: toolError.message, stack: toolError.stack });
          currentToolResult = { success: false, error: `Server error executing tool '${functionName}': ${toolError.message}` };
        }

        // --- Store Tool Result Message ---
        const toolResultMessage = {
            sender: 'tool',
            message: currentToolResult?.message || (currentToolResult?.success ? `Executed ${functionName}` : `Failed to execute ${functionName}`), // User-friendly summary
            type: 'tool_result',
            tool_call_id: toolCallId,
            tool_name: functionName,
            toolResultData: currentToolResult, // Store the actual result object
            timestamp: new Date()
        };
        chat.messages.push(toolResultMessage);
        toolResultsForClient.push(currentToolResult); // Also send raw result to client if needed

        // Prepare result object for sending back to AI
        executedToolResults.push({
            tool_call_id: toolCallId,
            name: functionName,
            result: currentToolResult // Send the full result object back
        });

      } // --- End of tool call execution loop ---

      // --- 5c. Send Tool Results Back to AI ---
      // Add the tool result messages to the history for the AI's context
      executedToolResults.forEach(tr => {
        followUpHistory.push({
             role: 'tool',
             tool_call_id: tr.tool_call_id,
             name: tr.name,
             // Content MUST be a string for the OpenAI API
             content: JSON.stringify(tr.result)
            });
      });

      const followUpPayload = {
          model: aiModel, // Use same model
          messages: followUpHistory,
          // Do NOT include 'tools' or 'tool_choice' here unless you expect chained calls
          referrer: process.env.POLLINATIONS_REFERRER || "DostifyApp-Backend"
        };
      logger.info(`[${requestId}] [Chat ${sessionId}] Sending tool results back to AI API`, { url: aiApiUrl });

      let followUpApiResponse;
      try {
        followUpApiResponse = await axios.post(aiApiUrl, followUpPayload, { timeout: 120000 });
        logger.info(`[${requestId}] [Chat ${sessionId}] AI API (Follow-up) response status: ${followUpApiResponse.status}`);
      } catch (apiError) {
        const errorDetails = apiError.response ? { status: apiError.response.status, data: apiError.response.data } : { message: apiError.message };
        logger.error(`[${requestId}] [Chat ${sessionId}] AI API Error (Follow-up Call)`, { error: errorDetails });
        // Save chat state up to tool results even if follow-up fails
        try { await chat.save(); } catch (saveErr) { logger.error(`[${requestId}] [Chat ${sessionId}] Failed to save tool results after AI follow-up error`, { saveError: saveErr.message }); }
        return res.status(502).json({
            message: 'Executed requested actions, but the AI failed to provide a final response.',
            toolResults: toolResultsForClient, // Let client know what happened
            sessionId: chat.sessionId,
            timestamp: new Date().toISOString()
        });
      }

      // Process the final response from AI after getting tool results
      // Ensure the final response has content
      if (!followUpApiResponse.data?.choices?.[0]?.message?.content) {
        logger.warn(`[${requestId}] [Chat ${sessionId}] AI follow-up response missing content`, { responseData: followUpApiResponse.data });
        // Decide if this is an error or if AI just had nothing more to say
        finalAiMessageContent = null; // Indicate no further text response
        // If you expect text, treat it as an error:
        // try { await chat.save(); } catch (saveErr) { /* log */ }
        // return res.status(502).json({
        //     message: 'Error: Received an unexpected final response format from the AI service after actions.',
        //     toolResults: toolResultsForClient,
        //     sessionId: chat.sessionId,
        //     timestamp: new Date().toISOString()
        // });
      } else {
          finalAiMessageContent = followUpApiResponse.data.choices[0].message.content; // Get the final text response
          logger.info(`[${requestId}] [Chat ${sessionId}] Received final AI response after tool execution.`);
      }


    } else {
      // --- 6. No Tool Call (Direct Response) ---
      logger.info(`[${requestId}] [Chat ${sessionId}] AI responded directly without tool calls.`);
      finalAiMessageContent = responseMessage.content; // Already have the content from initial response
      // Ensure we handle the case where the direct response might be empty/null
      if (finalAiMessageContent === null || finalAiMessageContent === undefined) {
          logger.warn(`[${requestId}] [Chat ${sessionId}] AI direct response content is null or undefined.`);
          finalAiMessageContent = null; // Explicitly set to null if empty
      }
    }

    // --- 7. Save Final AI Response (if content exists) ---
    if (finalAiMessageContent && finalAiMessageContent.trim()) {
      const aiMessageToSave = {
          sender: 'ai',
          message: finalAiMessageContent,
          type: 'text', // Assuming final response is text
          timestamp: new Date()
          // tool_calls: undefined, // Ensure tool_calls isn't accidentally carried over if logic changes
      };
      chat.messages.push(aiMessageToSave);
    } else {
      // Log if the final content was indeed empty after all processing
      logger.info(`[${requestId}] [Chat ${sessionId}] Final AI message content was empty or null. Not saving empty AI message.`);
      // Optionally, save a placeholder if you always want an AI entry after user input:
      // chat.messages.push({ sender: 'ai', message: "[AI provided no further text response]", type: 'text', timestamp: new Date() });
    }

    // --- 8. Final Save and Response to Client ---
    chat.lastActivity = new Date();
    await chat.save(); // Persist all changes (user msg, AI requests, tool results, final AI msg)
    logger.info(`[${requestId}] [Chat ${sessionId}] Chat interaction completed and saved.`);

    // Decide what to send back: just the new messages, or the whole (updated) chat object?
    // Sending recent messages is often better for performance.
    const messagesToSend = chat.messages.slice(-15); // Send last 15 messages as example

    res.json({
      messages: messagesToSend, // Send a slice of recent messages
      // Consider adding the full updated chat._id if client needs it
      // chatId: chat._id,
      toolResults: toolResultsForClient.length > 0 ? toolResultsForClient : undefined, // Include tool results if any
      sessionId: chat.sessionId,
      timestamp: new Date().toISOString() // Timestamp of the overall response generation
    });

  } catch (err) {
     // Catch potential errors during the find/save operations or unexpected issues
    logger.error(`[${requestId}] [Chat ${sessionId || 'N/A'}] POST /api/chat Unhandled Error`, { error: err.message, stack: err.stack, userId: userId });
    // Avoid sending stack trace in production
    const errorMessage = process.env.NODE_ENV === 'production'
        ? 'An unexpected server error occurred while processing your message.'
        : `Server Error: ${err.message}`;
    res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
});


// --- Other Chat Session Management Routes ---

// GET /api/chat/sessions - List all chat sessions for the user
router.get('/sessions', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  logger.info(`[${requestId}] GET /api/chat/sessions request received`, { userId });
  try {
    const sessions = await Chat.find({ user: userId })
      .select('sessionId title createdAt lastActivity messages') // Select messages to get count easily
      .sort({ lastActivity: -1 }) // Sort by most recent activity
      .lean(); // Use lean for performance as we are just reading and transforming

    const sessionSummaries = sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title || `Chat from ${new Date(s.createdAt).toLocaleDateString()}`,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      messageCount: s.messages?.length || 0, // Calculate message count
      // Optionally add snippet of last message:
      // lastMessageSnippet: s.messages?.[s.messages.length - 1]?.message?.substring(0, 50) + '...'
    }));
    logger.info(`[${requestId}] GET /api/chat/sessions success`, { userId, count: sessionSummaries.length });
    res.json(sessionSummaries);
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions error`, { userId, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not fetch chat sessions', error: err.message });
  }
});

// GET /api/chat/sessions/search - Search chat sessions by title
router.get('/sessions/search', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { q } = req.query; // Search query parameter
  logger.info(`[${requestId}] GET /api/chat/sessions/search request received`, { userId, query: q });

  // Validate query parameter
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
       return res.status(400).json({ message: 'Missing or invalid search query parameter "q"' });
   }
  const trimmedQuery = q.trim();

  try {
    // Use regex for case-insensitive search on title
    // Index on 'user' and 'title' would improve performance if needed: ChatSchema.index({ user: 1, title: 'text' });
    const sessions = await Chat.find({
        user: userId,
        title: { $regex: trimmedQuery, $options: 'i' } // Case-insensitive regex search
       })
      .select('sessionId title createdAt lastActivity messages')
      .sort({ lastActivity: -1 }) // Sort results
      .limit(50) // Limit the number of search results returned
      .lean();

    const sessionSummaries = sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title || `Chat from ${new Date(s.createdAt).toLocaleDateString()}`,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      messageCount: s.messages?.length || 0
    }));
    logger.info(`[${requestId}] GET /api/chat/sessions/search success`, { userId, query: trimmedQuery, count: sessionSummaries.length });
    res.json(sessionSummaries);
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions/search error`, { userId, query: trimmedQuery, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not search chat sessions', error: err.message });
  }
});

// PATCH /api/chat/sessions/:sessionId/title - Rename a chat session
router.patch('/sessions/:sessionId/title', auth, validate(renameSchema), async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  const { title } = req.body; // New title from request body
  logger.info(`[${requestId}] PATCH /api/chat/sessions/:sessionId/title request received`, { userId, sessionId, newTitle: title });

  try {
    // Find the specific chat belonging to the user and update its title
    const chat = await Chat.findOneAndUpdate(
        { user: userId, sessionId: sessionId }, // Query criteria
        { $set: { title: title } }, // Update operation
        { new: true } // Options: return the updated document
      ).select('sessionId title'); // Only select necessary fields for the response

    if (!chat) {
         // If no chat found matching user and sessionId
         return res.status(404).json({ message: 'Chat session not found or you do not have permission to modify it.' });
     }
    logger.info(`[${requestId}] PATCH /api/chat/sessions/:sessionId/title success`, { userId, sessionId });
    res.json({ sessionId: chat.sessionId, title: chat.title }); // Return updated info
  } catch (err) {
    logger.error(`[${requestId}] PATCH /api/chat/sessions/:sessionId/title error`, { userId, sessionId, newTitle: title, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not rename session', error: err.message });
  }
});

// DELETE /api/chat/sessions/:sessionId - Delete a chat session
router.delete('/sessions/:sessionId', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  logger.info(`[${requestId}] DELETE /api/chat/sessions/:sessionId request received`, { userId, sessionId });

  try {
    // Find and delete the chat document matching user and sessionId
    const result = await Chat.findOneAndDelete({ user: userId, sessionId: sessionId });

    if (!result) {
         // If no chat session was found and deleted
         return res.status(404).json({ message: 'Chat session not found or you do not have permission to delete it.' });
     }
    logger.info(`[${requestId}] DELETE /api/chat/sessions/:sessionId success`, { userId, sessionId });
    res.json({ message: 'Session deleted successfully', sessionId: sessionId }); // Confirmation message
  } catch (err) {
    logger.error(`[${requestId}] DELETE /api/chat/sessions/:sessionId error`, { userId, sessionId, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not delete session', error: err.message });
  }
});

// GET /api/chat/sessions/:sessionId/export - Export a chat session as JSON
router.get('/sessions/:sessionId/export', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/export request received`, { userId, sessionId });

  try {
    // Find the chat, exclude user ID and mongo default fields (_id, __v) from export
    const chat = await Chat.findOne({ user: userId, sessionId: sessionId })
        .select('sessionId title messages createdAt lastActivity -_id -user -__v') // Exclude fields using minus sign
        .lean(); // Use lean for plain JavaScript object

    if (!chat) {
         return res.status(404).json({ message: 'Session not found or access denied.' });
     }

    // Sanitize filename to prevent issues
    const safeSessionId = sessionId.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
    const filename = `dostify_chat_${safeSessionId}_${new Date().toISOString().split('T')[0]}.json`;

    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/export success`, { userId, sessionId });
    res.json(chat); // Send the selected chat data as JSON response body
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions/:sessionId/export error`, { userId, sessionId, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not export session', error: err.message });
  }
});

// GET /api/chat/sessions/:sessionId/messages - Get messages for a session (paginated)
router.get('/sessions/:sessionId/messages', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  const { page = 1, limit = 20 } = req.query; // Default page 1, limit 20
  logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/messages request received`, { userId, sessionId, page, limit });

  try {
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Validate pagination parameters
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) { // Set a max limit (e.g., 100)
        return res.status(400).json({ message: 'Invalid page or limit parameter. Page must be >= 1, limit must be between 1 and 100.' });
     }

    const skip = (pageNum - 1) * limitNum;

    // Method 1: Using find and slice (simpler, potentially less efficient for very large arrays)
     const chat = await Chat.findOne({ user: userId, sessionId: sessionId })
         .select('messages sessionId') // Select only messages and sessionId
         // Project only the needed fields from the messages array
         .populate({ // Or use projection within find if populate isn't needed
             path: 'messages',
             select: 'sender message type imageUrl feedback timestamp tool_calls tool_call_id tool_name toolResultData _id', // Include _id if needed by frontend
             options: {
                 sort: { timestamp: -1 }, // Sort messages newest first *before* slicing/skipping if needed
                 skip: skip,
                 limit: limitNum
             }
         });


     // Method 2: Using Aggregation (more complex, potentially more efficient)
    /*
    const aggregation = await Chat.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), sessionId: sessionId } },
      { $project: {
          sessionId: 1,
          totalMessages: { $size: "$messages" },
          // Slice the messages array for pagination
          messages: { $slice: ["$messages", skip, limitNum] }
          // Unwind and re-project if you need to sort messages before slicing, which is more complex
      }},
      // Optional: Project specific fields from the sliced messages if needed
      // { $project: { sessionId: 1, totalMessages: 1, 'messages.sender': 1, ... } }
    ]);

    if (aggregation.length === 0) {
        return res.status(404).json({ message: 'Chat session not found or access denied.' });
    }
    const chatData = aggregation[0];
    const total = chatData.totalMessages;
    const messages = chatData.messages || [];
    */

    if (!chat) {
        return res.status(404).json({ message: 'Chat session not found or access denied.' });
    }

    // Need total count separately if using Method 1
    const total = await Chat.countDocuments({ user: userId, sessionId: sessionId }); // This counts sessions, not messages
    const totalMessagesResult = await Chat.aggregate([ // Need to count messages in the specific chat
        { $match: { user: new mongoose.Types.ObjectId(userId), sessionId: sessionId } },
        { $project: { messageCount: { $size: "$messages" } } }
    ]);
    const totalMsgCount = totalMessagesResult.length > 0 ? totalMessagesResult[0].messageCount : 0;

    logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/messages success`, { userId, sessionId, count: chat.messages.length, total: totalMsgCount });
    res.json({
        sessionId: chat.sessionId,
        messages: chat.messages || [],
        total: totalMsgCount, // Use the accurate message count
        page: pageNum,
        limit: limitNum
     });
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions/:sessionId/messages error`, { userId, sessionId, query: req.query, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not fetch messages', error: err.message });
  }
});


// POST /api/chat/:sessionId/feedback - Submit feedback for a specific AI message
router.post('/:sessionId/feedback', auth, validate(feedbackSchema), async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  // Assume frontend might send index OR messageId, prioritize messageId if available
  const { messageIndex, feedback } = req.body;
  // const messageId = req.body.messageId; // If frontend sends messageId

  logger.info(`[${requestId}] POST /api/chat/:sessionId/feedback request received`, { userId, sessionId, messageIndex, feedback });

  try {
    // Find the chat session
    const chat = await Chat.findOne({ user: userId, sessionId: sessionId }).select('messages'); // Need messages to find _id by index
    if (!chat) {
        return res.status(404).json({ message: 'Chat session not found or access denied.' });
    }

    // --- Find message _id using index (if messageId not sent directly) ---
    if (messageIndex === undefined || messageIndex === null || messageIndex < 0 || messageIndex >= chat.messages.length) {
        return res.status(400).json({ message: 'Invalid or missing message index provided.' });
    }
    const targetMessage = chat.messages[messageIndex];
    if (!targetMessage) {
        // Should not happen if index is valid, but check anyway
        return res.status(400).json({ message: `Message at index ${messageIndex} not found.`});
    }
    if (targetMessage.sender !== 'ai') {
        // Ensure feedback is only for AI messages
        return res.status(400).json({ message: 'Feedback can only be provided for AI messages.' });
    }
    const messageIdToUpdate = targetMessage._id; // Get the actual _id of the subdocument
    if (!messageIdToUpdate) {
         logger.error(`[${requestId}] Message at index ${messageIndex} lacks _id in session ${sessionId}`);
         return res.status(500).json({ message: 'Internal error: Cannot identify message for feedback.' });
    }
    // --- End Find message _id ---

    // Use the message's _id to update feedback atomically
    const updateResult = await Chat.updateOne(
      {
          // Match the chat document AND the specific message within the array
          _id: chat._id, // More specific match using chat's _id
          "messages._id": messageIdToUpdate // Target the specific message subdocument by its _id
      },
      {
          // Update the feedback field of the matched array element
          $set: { "messages.$.feedback": feedback } // Use the positional $ operator
      }
    );

    if (updateResult.matchedCount === 0) {
         // This indicates the chat or the specific message wasn't found during the update operation
         logger.warn(`[${requestId}] Feedback update failed to match document/message`, { userId, sessionId, messageId: messageIdToUpdate });
         return res.status(404).json({ message: 'Could not find the specific message to update feedback. It might have been deleted.' });
     }
    if (updateResult.modifiedCount === 0) {
        // This means the message was found, but the feedback value was already set to the provided value
         logger.info(`[${requestId}] POST /api/chat/:sessionId/feedback feedback unchanged (already ${feedback})`, { userId, sessionId, messageId: messageIdToUpdate });
     } else {
        // Successfully updated
        logger.info(`[${requestId}] POST /api/chat/:sessionId/feedback success`, { userId, sessionId, messageId: messageIdToUpdate, feedback });
     }

    res.json({ message: 'Feedback saved successfully' });
  } catch (err) {
    logger.error(`[${requestId}] POST /api/chat/:sessionId/feedback error`, { userId, sessionId, body: req.body, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Server error while saving feedback', error: err.message });
  }
});


// POST /api/chat/:sessionId/save-task - Manually save a task derived from chat context
router.post('/:sessionId/save-task', auth, validate(saveTaskSchema), async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params; // SessionId is mainly for context logging here
  const { title, description, dueDate } = req.body; // Task details from request body
  logger.info(`[${requestId}] POST /api/chat/:sessionId/save-task request received`, { userId, sessionId, title, description, dueDate });

  try {
    // Create a new Task document associated with the authenticated user
    const task = new Task({
        user: userId,
        title: title,
        description: description,
        // Ensure dueDate is stored as a Date object if provided, otherwise undefined
        dueDate: dueDate ? new Date(dueDate) : undefined
    });
    // Save the new task to the database
    await task.save();
    logger.info(`[${requestId}] POST /api/chat/:sessionId/save-task success`, { userId, sessionId, taskId: task._id });
    // Respond with the newly created task object
    res.status(201).json(task); // HTTP 201 Created status
  } catch (err) {
    logger.error(`[${requestId}] POST /api/chat/:sessionId/save-task error`, { userId, sessionId, body: req.body, error: err.message, stack: err.stack });
    // Handle potential validation errors from the Task model schema
    if (err.name === 'ValidationError') {
        return res.status(400).json({ message: 'Task validation failed', error: err.message });
    }
    // Generic server error for other issues
    res.status(500).json({ message: 'Server error saving task', error: err.message });
  }
});


module.exports = router;
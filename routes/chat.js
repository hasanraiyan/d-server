// FILE: routes/chat.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); // Import mongoose for ObjectId usage
const Chat = require('../models/Chat');
const auth = require('../middleware/auth');
const axios = require('axios');
const Joi = require('joi');
const validate = require('../middleware/validate');
const Task = require('../models/Task');
const MoodLog = require('../models/MoodLog');
const logger = require('../logger'); // Import your logger

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
  type: Joi.string().valid('text', 'image').default('text'),
  imageUrl: Joi.string().uri().when('type', { is: 'image', then: Joi.required(), otherwise: Joi.forbidden() })
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


// --- Main Chat POST endpoint with Pollinations Integration & Tool Calling ---
router.post('/', auth, validate(chatSchema), async (req, res) => {
  const { message, sessionId, type, imageUrl } = req.body;
  const userId = req.userId;
  const requestId = req.id;

  logger.info(`[${requestId}] [Chat ${sessionId}] POST /api/chat started`, { userId, type });

  try {
    let chat = await Chat.findOne({ user: userId, sessionId });

    if (!chat) {
      logger.info(`[${requestId}] [Chat ${sessionId}] Creating new chat session`, { userId });
      chat = new Chat({ user: userId, sessionId, messages: [] });
    }

    // --- 1. Prepare context for AI ---
    const CONTEXT_LIMIT = 10;
    const history = chat.messages.slice(-CONTEXT_LIMIT).map(m => {
      let messageObject = { role: '', content: null };
      if (m.sender === 'user') {
        messageObject.role = 'user';
        let contentArray = [{ type: 'text', text: m.message || "" }];
        if (m.type === 'image' && m.imageUrl) {
          contentArray.push({ type: 'image_url', image_url: { url: m.imageUrl } });
        }
        messageObject.content = contentArray;
      } else if (m.sender === 'ai') {
        messageObject.role = 'assistant';
        if (m.tool_calls && m.tool_calls.length > 0) {
          messageObject.content = m.message; // May be null
          messageObject.tool_calls = m.tool_calls;
        } else {
          messageObject.content = m.message;
        }
      } else if (m.sender === 'tool') {
        return { role: 'tool', tool_call_id: m.tool_call_id, name: m.tool_name, content: m.message };
      } else {
        logger.warn(`[${requestId}] [Chat ${sessionId}] Skipping message with unknown sender type: ${m.sender}`);
        return null;
      }
      if ((messageObject.role === 'user' || messageObject.role === 'assistant') && messageObject.content === null) {
        if (!(messageObject.role === 'assistant' && messageObject.tool_calls && messageObject.tool_calls.length > 0)) {
          messageObject.content = "";
        }
      }
      return messageObject;
    }).filter(m => m !== null);

    let currentUserMessageContent = [{ type: 'text', text: message }];
    if (type === 'image' && imageUrl) {
      currentUserMessageContent.push({ type: 'image_url', image_url: { url: imageUrl } });
    }
    history.push({ role: 'user', content: currentUserMessageContent });

    // --- 2. Save User Message to DB ---
    const userMessageToSave = {
      sender: 'user', message: message, type: type,
      imageUrl: type === 'image' ? imageUrl : undefined, timestamp: new Date()
    };
    chat.messages.push(userMessageToSave);
    chat.lastActivity = new Date();
    await chat.save();
    logger.info(`[${requestId}] [Chat ${sessionId}] User message saved to DB`);

    // --- 3. First API Call to Pollinations ---
    const apiPayload = {
      model: process.env.AI_MODEL || 'openai',
      messages: history,
      tools: aiTools.length > 0 ? aiTools : undefined,
      tool_choice: aiTools.length > 0 ? "auto" : undefined,
      referrer: process.env.POLLINATIONS_REFERRER || "DostifyApp-Backend"
    };

    logger.info(`[${requestId}] [Chat ${sessionId}] Calling Pollinations API (Initial)`, { url: process.env.AI_API_URL, model: apiPayload.model });
    let aiApiResponse;
    try {
      aiApiResponse = await axios.post(process.env.AI_API_URL, apiPayload, { timeout: 120000 });
      logger.info(`[${requestId}] [Chat ${sessionId}] Pollinations API (Initial) response status: ${aiApiResponse.status}`);
    } catch (apiError) {
      logger.error(`[${requestId}] [Chat ${sessionId}] Pollinations API Error (Initial Call)`, { /* ... error details ... */ });
      return res.status(502).json({ message: 'Error: Could not reach the AI service. Please try again later.' });
    }

    // --- 4. Process API Response ---
    if (!aiApiResponse.data?.choices?.[0]) {
      logger.error(`[${requestId}] [Chat ${sessionId}] Invalid response structure from Pollinations`, { responseData: aiApiResponse.data });
      return res.status(502).json({ message: 'Error: Received an invalid response from the AI service.' });
    }

    const responseChoice = aiApiResponse.data.choices[0];
    const responseMessage = responseChoice.message;
    let finalAiMessageContent = responseMessage.content;
    let toolResultsForClient = [];

    // --- 5. Handle Tool Calls ---
    if (responseMessage.tool_calls && responseChoice.finish_reason === 'tool_calls') {
      logger.info(`[${requestId}] [Chat ${sessionId}] AI requested tool calls`, { /* ... call details ... */ });

      const assistantToolCallMessage = {
        sender: 'ai', message: responseMessage.content, type: 'tool_request',
        tool_calls: responseMessage.tool_calls, timestamp: new Date()
      };
      chat.messages.push(assistantToolCallMessage);

      const followUpHistory = [...history, responseMessage];
      let executedToolResults = [];

      // --- 5a. Execute Tool Calls ---
      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const toolCallId = toolCall.id;
        let functionArgs;
        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          logger.error(`[${requestId}] [Chat ${sessionId}] Failed to parse tool arguments for ${functionName}`, { /* ... error details ... */ });
          const errorResult = { success: false, error: "Invalid arguments provided by AI." };
          executedToolResults.push({ tool_call_id: toolCallId, name: functionName, result: errorResult });
          chat.messages.push({ sender: 'tool', message: JSON.stringify(errorResult), type: 'tool_result', tool_call_id: toolCallId, tool_name: functionName, timestamp: new Date() });
          continue;
        }

        let currentToolResult = null;
        logger.info(`[${requestId}] [Chat ${sessionId}] Executing tool: ${functionName}`, { toolCallId, args: functionArgs });
        try {
          // --- Tool Execution Logic ---
          if (functionName === 'log_mood') {
            // ... (implementation as before)
            const moodValue = parseInt(functionArgs.mood);
            if (isNaN(moodValue) || moodValue < 1 || moodValue > 10) throw new Error("Mood value must be an integer between 1 and 10.");
            const moodDoc = new MoodLog({ user: userId, mood: moodValue, note: functionArgs.note });
            await moodDoc.save();
            currentToolResult = { success: true, message: `Mood (${moodValue}) logged successfully.` };
          } else if (functionName === 'create_task') {
            // ... (implementation as before)
            let parsedDueDate;
            if (functionArgs.dueDate) { /* ... date parsing ... */
              try {
                if (typeof functionArgs.dueDate === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(functionArgs.dueDate)) logger.warn(`[${requestId}] [Chat ${sessionId}] Potentially non-ISO date for create_task: "${functionArgs.dueDate}". Attempting parse.`);
                parsedDueDate = new Date(functionArgs.dueDate);
                if (isNaN(parsedDueDate.getTime())) throw new Error('Invalid date format provided.');
              } catch (dateError) {
                logger.warn(`[${requestId}] [Chat ${sessionId}] Error parsing date for create_task: "${functionArgs.dueDate}". Task created without due date.`, { error: dateError });
                parsedDueDate = undefined;
              }
            }
            const taskDoc = new Task({ user: userId, title: functionArgs.title, description: functionArgs.description, dueDate: parsedDueDate });
            await taskDoc.save();
            let message = `Task "${functionArgs.title}" created successfully.`;
            if (parsedDueDate) message += ` Due: ${parsedDueDate.toLocaleDateString()}`;
            currentToolResult = { success: true, message: message, taskId: taskDoc._id.toString() };
          } else if (functionName === 'get_tasks') {
            // ... (implementation as before)
            const filter = { user: userId };
            if (typeof functionArgs.completed === 'boolean') filter.completed = functionArgs.completed;
            const tasks = await Task.find(filter).select('title description dueDate completed _id').sort({ dueDate: 1, createdAt: -1 }).limit(25);
            if (tasks.length === 0) currentToolResult = { success: true, message: "No tasks found matching the criteria." };
            else currentToolResult = { success: true, tasks: tasks.map(t => ({ id: t._id.toString(), title: t.title, description: t.description || 'No description', dueDate: t.dueDate?.toISOString().split('T')[0] || 'No due date', completed: t.completed })) };
          } else if (functionName === 'get_mood_history') {
            // ... (implementation as before)
            const days = parseInt(functionArgs.days) || 30;
            if (isNaN(days) || days <= 0) throw new Error("Number of days must be a positive integer.");
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            const moods = await MoodLog.find({ user: userId, createdAt: { $gte: since } }).select('mood note createdAt').sort({ createdAt: -1 }).limit(50);
            if (moods.length === 0) currentToolResult = { success: true, message: `No mood logs found in the last ${days} days.` };
            else currentToolResult = { success: true, moods: moods.map(m => ({ mood: m.mood, note: m.note || 'No note', date: m.createdAt.toISOString().split('T')[0] })) };
          }
          // --- NEW/RESTORED Tool Implementations ---
          else if (functionName === 'update_task') {
            const { identifier, newTitle, newDescription, newDueDate, markCompleted } = functionArgs;
            const query = mongoose.Types.ObjectId.isValid(identifier)
              ? { _id: identifier, user: userId }
              : { title: identifier, user: userId }; // Find by ID or title

            const updateFields = { $set: {} };
            let changesMade = false;
            if (newTitle) { updateFields.$set.title = newTitle; changesMade = true; }
            if (newDescription !== undefined) { updateFields.$set.description = newDescription; changesMade = true; } // Allow empty description
            if (markCompleted !== undefined) { updateFields.$set.completed = markCompleted; changesMade = true; }
            if (newDueDate) {
              try {
                const parsedDate = new Date(newDueDate);
                if (isNaN(parsedDate.getTime())) throw new Error('Invalid date format for newDueDate.');
                updateFields.$set.dueDate = parsedDate;
                changesMade = true;
              } catch (dateError) {
                logger.warn(`[${requestId}] [Chat ${sessionId}] Invalid date for update_task: "${newDueDate}". Date not updated.`, { error: dateError });
                // Optionally inform AI/user? For now, just skip date update.
              }
            }

            if (!changesMade) {
              currentToolResult = { success: false, error: "No update fields provided (newTitle, newDescription, newDueDate, markCompleted)." };
            } else {
              const updatedTask = await Task.findOneAndUpdate(query, updateFields, { new: true });
              if (!updatedTask) {
                currentToolResult = { success: false, error: `Task with identifier "${identifier}" not found.` };
              } else {
                currentToolResult = { success: true, message: `Task "${updatedTask.title}" updated successfully.` };
              }
            }
          } else if (functionName === 'delete_task') {
            const { identifier } = functionArgs;
            const query = mongoose.Types.ObjectId.isValid(identifier)
              ? { _id: identifier, user: userId }
              : { title: identifier, user: userId };

            const deletedTask = await Task.findOneAndDelete(query);
            if (!deletedTask) {
              currentToolResult = { success: false, error: `Task with identifier "${identifier}" not found.` };
            } else {
              currentToolResult = { success: true, message: `Task "${deletedTask.title}" deleted successfully.` };
            }
          } else if (functionName === 'get_session_summary') {
            // The session is already loaded in the `chat` variable
            const summary = {
              sessionId: chat.sessionId,
              title: chat.title || `Chat from ${new Date(chat.createdAt).toLocaleDateString()}`,
              createdAt: chat.createdAt,
              lastActivity: chat.lastActivity,
              messageCount: chat.messages.length,
              // Maybe add first few/last few messages? Be careful with length.
              // lastMessage: chat.messages.length > 0 ? chat.messages[chat.messages.length - 1]?.message?.substring(0,100) : 'No messages yet.'
            };
            currentToolResult = { success: true, summary: summary };
          } else if (functionName === 'give_feedback') {
            const { messageIndex, rating } = functionArgs;
            const targetIndex = chat.messages.length - 1 - messageIndex; // Assume index is from recent history (0 = last AI msg)

            if (targetIndex < 0 || targetIndex >= chat.messages.length) {
              currentToolResult = { success: false, error: `Invalid message index ${messageIndex}. Max index is ${chat.messages.length - 1}.` };
            } else {
              const targetMessage = chat.messages[targetIndex];
              if (targetMessage.sender !== 'ai') {
                currentToolResult = { success: false, error: "Feedback can only be given for AI messages." };
              } else if (isNaN(parseInt(rating)) || rating < 1 || rating > 5) {
                currentToolResult = { success: false, error: "Rating must be an integer between 1 and 5." };
              } else {
                // Update directly in the loaded chat document for this request
                targetMessage.feedback = rating;
                // Mark the document as modified if directly manipulating subdocuments
                chat.markModified('messages');
                // The save will happen at the end of the request
                currentToolResult = { success: true, message: `Feedback (${rating}) recorded for message.` };
              }
            }
          }
          // --- End NEW/RESTORED Tool Implementations ---
          else {
            logger.warn(`[${requestId}] [Chat ${sessionId}] Unknown tool called: ${functionName}`);
            currentToolResult = { success: false, error: `Tool '${functionName}' is not available.` };
          }
          logger.info(`[${requestId}] [Chat ${sessionId}] Tool ${functionName} executed`, { toolCallId, success: currentToolResult.success });

        } catch (toolError) {
          logger.error(`[${requestId}] [Chat ${sessionId}] Error executing tool ${functionName}`, { toolCallId, args: functionArgs, error: toolError.message, stack: toolError.stack });
          currentToolResult = { success: false, error: `An error occurred while trying to execute the tool: ${toolError.message}` };
        }

        executedToolResults.push({ tool_call_id: toolCallId, name: functionName, result: currentToolResult });
        chat.messages.push({ sender: 'tool', message: JSON.stringify(currentToolResult), type: 'tool_result', tool_call_id: toolCallId, tool_name: functionName, timestamp: new Date() });
        toolResultsForClient.push(currentToolResult); // Add simplified result for client response
      } // End of tool call execution loop

      // --- 5b. Send Tool Results Back to AI ---
      executedToolResults.forEach(tr => {
        followUpHistory.push({ role: 'tool', tool_call_id: tr.tool_call_id, name: tr.name, content: JSON.stringify(tr.result) });
      });

      const followUpPayload = { model: process.env.AI_MODEL || 'openai', messages: followUpHistory, referrer: process.env.POLLINATIONS_REFERRER || "DostifyApp-Backend" };
      logger.info(`[${requestId}] [Chat ${sessionId}] Sending tool results back to Pollinations API`, { url: process.env.AI_API_URL });
      let followUpApiResponse;
      try {
        followUpApiResponse = await axios.post(process.env.AI_API_URL, followUpPayload, { timeout: 120000 });
        logger.info(`[${requestId}] [Chat ${sessionId}] Pollinations API (Follow-up) response status: ${followUpApiResponse.status}`);
      } catch (apiError) {
        logger.error(`[${requestId}] [Chat ${sessionId}] Pollinations API Error (Follow-up Call)`, { /* ... error details ... */ });
        await chat.save(); // Save chat state up to tool results
        return res.status(502).json({ message: 'Executed requested actions, but failed to get final summary from AI.', toolResults: toolResultsForClient, sessionId: chat.sessionId, timestamp: new Date().toISOString() });
      }

      if (!followUpApiResponse.data?.choices?.[0]) {
        logger.error(`[${requestId}] [Chat ${sessionId}] Invalid structure from Pollinations follow-up`, { responseData: followUpApiResponse.data });
        await chat.save();
        return res.status(502).json({ message: 'Error: Received invalid final response from AI service after executing actions.', toolResults: toolResultsForClient, sessionId: chat.sessionId, timestamp: new Date().toISOString() });
      }
      finalAiMessageContent = followUpApiResponse.data.choices[0].message.content;
      logger.info(`[${requestId}] [Chat ${sessionId}] Received final AI response after tool execution.`);

    } else {
      // --- 6. No Tool Call ---
      logger.info(`[${requestId}] [Chat ${sessionId}] AI responded directly.`);
      finalAiMessageContent = responseMessage.content;
    }

    // --- 7. Save Final AI Response and Send to Client ---
    if (finalAiMessageContent !== null && finalAiMessageContent !== undefined && finalAiMessageContent.trim() !== "") {
      const aiMessageToSave = { sender: 'ai', message: finalAiMessageContent, type: 'text', timestamp: new Date() };
      chat.messages.push(aiMessageToSave);
    } else {
      logger.warn(`[${requestId}] [Chat ${sessionId}] Final AI message content was empty or null. Saving placeholder.`);
      const aiMessageToSave = { sender: 'ai', message: "[AI response was empty]", type: 'text', timestamp: new Date() };
      chat.messages.push(aiMessageToSave);
      finalAiMessageContent = finalAiMessageContent || ""; // Ensure string for client
    }

    chat.lastActivity = new Date();
    await chat.save();
    logger.info(`[${requestId}] [Chat ${sessionId}] Final AI response saved. Chat completed.`);

    // Respond to the client with only new messages for this interaction
    const lastUserMessageIndex = chat.messages.length - chat.messages.slice().reverse().findIndex(m => m.sender === 'user'); // Find the index of the user message saved at the start
    const newMessagesForClient = chat.messages.slice(lastUserMessageIndex - 1); // Get user message + subsequent tool/AI messages

    res.json({
      // newMessages: newMessagesForClient, // Send only new messages
      messages: chat.messages.slice(-5), // Or send last N messages
      ai: finalAiMessageContent,
      toolResults: toolResultsForClient.length > 0 ? toolResultsForClient : undefined,
      sessionId: chat.sessionId,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    logger.error(`[${requestId}] [Chat ${sessionId || 'N/A'}] POST /api/chat Unhandled Error`, { error: err.message, stack: err.stack, userId: userId });
    res.status(500).json({ message: 'An unexpected server error occurred while processing your message.', error: process.env.NODE_ENV !== 'production' ? err.message : undefined });
  }
});


// --- Other Chat Session Management Routes (Unchanged from previous version) ---

// List all chat sessions
router.get('/sessions', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  logger.info(`[${requestId}] GET /api/chat/sessions request received`, { userId });
  try {
    const sessions = await Chat.find({ user: userId })
      .select('sessionId title createdAt lastActivity messages')
      .sort({ lastActivity: -1 })
      .lean();
    const sessionSummaries = sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title || `Chat from ${new Date(s.createdAt).toLocaleDateString()}`,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      messageCount: s.messages?.length || 0
    }));
    logger.info(`[${requestId}] GET /api/chat/sessions success`, { userId, count: sessionSummaries.length });
    res.json(sessionSummaries);
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions error`, { userId, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not fetch chat sessions', error: err.message });
  }
});

// Search chat sessions
router.get('/sessions/search', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { q } = req.query;
  logger.info(`[${requestId}] GET /api/chat/sessions/search request received`, { userId, query: q });
  if (!q) { /* ... error handling ... */ return res.status(400).json({ message: 'Missing search query parameter "q"' }); }
  try {
    const sessions = await Chat.find({ user: userId, title: { $regex: q, $options: 'i' } })
      .select('sessionId title createdAt lastActivity messages')
      .sort({ lastActivity: -1 })
      .limit(50).lean();
    const sessionSummaries = sessions.map(s => ({ /* ... projection ... */
      sessionId: s.sessionId, title: s.title || `Chat from ${new Date(s.createdAt).toLocaleDateString()}`,
      createdAt: s.createdAt, lastActivity: s.lastActivity, messageCount: s.messages?.length || 0
    }));
    logger.info(`[${requestId}] GET /api/chat/sessions/search success`, { userId, query: q, count: sessionSummaries.length });
    res.json(sessionSummaries);
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions/search error`, { userId, query: q, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not search chat sessions', error: err.message });
  }
});

// Rename a chat session
router.patch('/sessions/:sessionId/title', auth, validate(renameSchema), async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  const { title } = req.body;
  logger.info(`[${requestId}] PATCH /api/chat/sessions/:sessionId/title request received`, { userId, sessionId, newTitle: title });
  try {
    const chat = await Chat.findOneAndUpdate({ user: userId, sessionId: sessionId }, { $set: { title: title } }, { new: true }).select('sessionId title');
    if (!chat) { /* ... not found handling ... */ return res.status(404).json({ message: 'Chat session not found or you do not have permission to modify it.' }); }
    logger.info(`[${requestId}] PATCH /api/chat/sessions/:sessionId/title success`, { userId, sessionId });
    res.json({ sessionId: chat.sessionId, title: chat.title });
  } catch (err) {
    logger.error(`[${requestId}] PATCH /api/chat/sessions/:sessionId/title error`, { userId, sessionId, newTitle: title, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not rename session', error: err.message });
  }
});

// Delete a chat session
router.delete('/sessions/:sessionId', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  logger.info(`[${requestId}] DELETE /api/chat/sessions/:sessionId request received`, { userId, sessionId });
  try {
    const result = await Chat.findOneAndDelete({ user: userId, sessionId: sessionId });
    if (!result) { /* ... not found handling ... */ return res.status(404).json({ message: 'Chat session not found or you do not have permission to delete it.' }); }
    logger.info(`[${requestId}] DELETE /api/chat/sessions/:sessionId success`, { userId, sessionId });
    res.json({ message: 'Session deleted successfully', sessionId: sessionId });
  } catch (err) {
    logger.error(`[${requestId}] DELETE /api/chat/sessions/:sessionId error`, { userId, sessionId, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not delete session', error: err.message });
  }
});

// Export a chat session
router.get('/sessions/:sessionId/export', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/export request received`, { userId, sessionId });
  try {
    const chat = await Chat.findOne({ user: userId, sessionId: sessionId }).select('sessionId title messages createdAt lastActivity -_id -user').lean();
    if (!chat) { /* ... not found handling ... */ return res.status(404).json({ message: 'Session not found or access denied.' }); }
    const filename = `dostify_chat_${sessionId}_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/export success`, { userId, sessionId });
    res.json(chat);
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions/:sessionId/export error`, { userId, sessionId, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not export session', error: err.message });
  }
});

// Paginated message retrieval
router.get('/sessions/:sessionId/messages', auth, async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/messages request received`, { userId, sessionId, page, limit });
  try {
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) { /* ... validation ... */ return res.status(400).json({ message: 'Invalid page or limit parameter. Limit must be between 1 and 100.' }); }
    const skip = (pageNum - 1) * limitNum;

    const aggregation = await Chat.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), sessionId: sessionId } },
      { $project: { _id: 0, sessionId: 1, totalMessages: { $size: "$messages" }, messages: { $slice: ["$messages", skip, limitNum] } } },
      { $project: { sessionId: 1, totalMessages: 1, 'messages.sender': 1, 'messages.message': 1, 'messages.type': 1, 'messages.imageUrl': 1, 'messages.feedback': 1, 'messages.timestamp': 1, 'messages.tool_calls': 1, 'messages.tool_call_id': 1, 'messages.tool_name': 1 } }
    ]);

    if (aggregation.length === 0) { /* ... not found handling ... */ return res.status(404).json({ message: 'Chat session not found or access denied.' }); }
    const result = aggregation[0];
    logger.info(`[${requestId}] GET /api/chat/sessions/:sessionId/messages success`, { userId, sessionId, count: result.messages.length, total: result.totalMessages });
    res.json({ sessionId: result.sessionId, messages: result.messages || [], total: result.totalMessages, page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error(`[${requestId}] GET /api/chat/sessions/:sessionId/messages error`, { userId, sessionId, query: req.query, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Could not fetch messages', error: err.message });
  }
});

// Submit feedback for an AI message
router.post('/:sessionId/feedback', auth, validate(feedbackSchema), async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  const { messageIndex, feedback } = req.body;
  logger.info(`[${requestId}] POST /api/chat/:sessionId/feedback request received`, { userId, sessionId, messageIndex, feedback });
  try {
    const chat = await Chat.findOne({ user: userId, sessionId: sessionId }).select('messages');
    if (!chat) { /* ... not found handling ... */ return res.status(404).json({ message: 'Chat session not found or access denied.' }); }
    if (messageIndex < 0 || messageIndex >= chat.messages.length) { /* ... index validation ... */ return res.status(400).json({ message: 'Invalid message index provided.' }); }

    const targetMessage = chat.messages[messageIndex];
    if (!targetMessage) { /* ... target message validation ... */ return res.status(400).json({ message: 'Could not find message at the specified index.' }); }
    if (targetMessage.sender !== 'ai') { /* ... sender validation ... */ return res.status(400).json({ message: 'Feedback can only be provided for AI messages.' }); }

    const messageIdToUpdate = targetMessage._id;
    if (!messageIdToUpdate) { /* ... ID validation ... */ return res.status(500).json({ message: 'Internal error identifying message for update.' }); }

    const updateResult = await Chat.updateOne(
      { user: userId, sessionId: sessionId, "messages._id": messageIdToUpdate },
      { $set: { "messages.$.feedback": feedback } }
    );

    if (updateResult.matchedCount === 0) { /* ... match validation ... */ return res.status(404).json({ message: 'Could not find the specific message to update feedback.' }); }
    if (updateResult.modifiedCount === 0) { /* ... no change logging ... */ logger.info(`[${requestId}] POST /api/chat/:sessionId/feedback feedback unchanged`, { userId, sessionId, messageIndex, feedback }); }
    else { logger.info(`[${requestId}] POST /api/chat/:sessionId/feedback success`, { userId, sessionId, messageIndex, feedback }); }

    res.json({ message: 'Feedback saved successfully' });
  } catch (err) {
    logger.error(`[${requestId}] POST /api/chat/:sessionId/feedback error`, { userId, sessionId, body: req.body, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Server error while saving feedback', error: err.message });
  }
});


// Save task directly to planner (e.g., user clicks button based on AI suggestion)
router.post('/:sessionId/save-task', auth, validate(saveTaskSchema), async (req, res) => {
  const userId = req.userId;
  const requestId = req.id;
  const { sessionId } = req.params;
  const { title, description, dueDate } = req.body;
  logger.info(`[${requestId}] POST /api/chat/:sessionId/save-task request received`, { userId, sessionId, title, description, dueDate });
  try {
    const task = new Task({ user: userId, title, description, dueDate: dueDate ? new Date(dueDate) : undefined });
    await task.save();
    logger.info(`[${requestId}] POST /api/chat/:sessionId/save-task success`, { userId, sessionId, taskId: task._id });
    res.status(201).json(task);
  } catch (err) {
    logger.error(`[${requestId}] POST /api/chat/:sessionId/save-task error`, { userId, sessionId, body: req.body, error: err.message, stack: err.stack });
    res.status(500).json({ message: 'Server error saving task', error: err.message });
  }
});


module.exports = router;
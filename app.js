require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const logger = require('./logger');
const expressWinston = require('express-winston');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const { swaggerUi, specs } = require('./swagger');

// Security headers
app.use(helmet());

// Rate limiting (apply to all API routes)
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.'
}));

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Request logging middleware
app.use(expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  msg: 'HTTP {{req.method}} {{req.url}} [id={{req.id}}] - status: {{res.statusCode}}',
  expressFormat: true,
  colorize: false,
  ignoreRoute: function (req, res) { return false; }
}));

app.use(cors());
app.use(express.json());

// Swagger API docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/planner', require('./routes/planner'));
app.use('/api/mood', require('./routes/mood'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/password-reset', require('./routes/passwordReset'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Test route
app.get('/', (req, res) => {
  res.send('Dostify backend is running');
});

// Example validated route (for reference, remove in prod)
app.post('/api/validate-example', (req, res) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required()
  });
  const { error } = schema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  res.json({ message: 'Validated successfully!' });
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => logger.info('MongoDB connected'))
.catch((err) => logger.error('MongoDB connection error', { error: err }));

// Error logging middleware (must be after routes)
app.use(expressWinston.errorLogger({
  winstonInstance: logger,
}));

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err, requestId: req.id });
  res.status(err.status || 500).json({
    message: 'Internal server error',
    requestId: req.id
  });
});

module.exports = app;

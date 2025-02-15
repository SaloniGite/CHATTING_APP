require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const http = require('http');
const socketIo = require('socket.io');
const connect = require('./db/db');
const UserModel = require('./models/user.model');
const ChatModel = require('./models/chats.model'); // Import Chat model

connect(); // Connect to MongoDB

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const userSockets = new Map();

// Middleware
app.set('view engine', 'ejs');
app.use(express.json());
app.use(
  session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        let user = await UserModel.findOne({ email });

        if (!user) {
          user = new UserModel({
            googleId: profile.id,
            email,
            displayName: profile.displayName,
            image: profile.photos[0].value,
          });
          await user.save();
        }

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await UserModel.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/chat');
  }
);

app.get('/chat', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const loggedInUser = req.user;
  const onlineUsers = await UserModel.find({
    socketId: { $ne: null },
    _id: { $ne: loggedInUser._id },
  });

  res.render('chat', {
    user: loggedInUser,
    onlineUsers,
  });
});

// Fetch chat history between two users
app.get('/chat/history/:userId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const senderId = req.user._id;
  const receiverId = req.params.userId;

  try {
    const messages = await ChatModel.find({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching chat history' });
  }
});

// Socket.io setup
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', async (userId) => {
    console.log('User joined with ID:', userId);
    userSockets.set(userId, socket.id);

    // Store userId in the socket object
    socket.userId = userId;

    try {
      await UserModel.findByIdAndUpdate(userId, { socketId: socket.id });
    } catch (error) {
      console.error('Error updating socketId:', error);
    }
  });

  // Handle sending messages
  socket.on('message', async (messageObject) => {
    console.log('Message received:', messageObject);

    const { receiverId, message } = messageObject;
    if (!receiverId || !message) {
      console.error('Invalid messageObject:', messageObject);
      return;
    }

    try {
      // Save message in the database
      const chatMessage = new ChatModel({
        sender: socket.userId,  // Save sender as the userId (not socket.id)
        receiver: receiverId,
        message
      });
      await chatMessage.save();

      // Send the message to the receiver
      const receiverSocketId = userSockets.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message', {
          senderId: socket.userId,  // Send sender as the userId (not socket.id)
          message,
        });
      }
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // Handle user disconnection
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);

    for (const [userId, sockId] of userSockets.entries()) {
      if (sockId === socket.id) {
        userSockets.delete(userId);
        await UserModel.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
        break;
      }
    }
  });
});

// Start the server
server.listen(3000, () => {
  console.log('Server running on port 3000');
});

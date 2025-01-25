require('dotenv').config();
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const express = require('express')
const app = express()
const connect = require('./db/db')
connect()
const UserModel = require('./models/user.model')
const http = require('http')
const SocketIo = require('socket.io')

app.set('view engine','ejs')
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
  },
  function(accessToken, refreshToken, profile, done) {
    // Here you can save the user profile to your database
    return done(null, profile);
  }));

  passport.serializeUser((user, done) => {
    done(null, user);
  });
  
  passport.deserializeUser((user, done) => {
    done(null, user);
  });


  app.get('/', (req, res) => {
    res.render('index')
  });
  
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );
  
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    async(req, res) => {
       const email = req.user.emails[0].value
       const user = await UserModel.findOne({email:email})
       if(!user){
        const newUser = new UserModel({
            googleId:req.user.id,
            email:email,
            displayName:req.user.displayName,
            image:req.user.photos[0].value
        })
        await newUser.save() 
        req.user = newUser;
       }
    res.redirect('/chat')  

    }
   
  );
  
  app.get('/chat',async(req,res)=>{
    if(!req.user){
        return res.redirect('/')
    }
    const LoggedInUser = await UserModel.findOne({email:req.user.emails[0].value})
    const onlineUsers = await UserModel.find({
      socketId:{
        $ne:null
      },
      _id:{
        $ne:LoggedInUser._id
      }
    })
    console.log(LoggedInUser)
    res.render('chat',{
        user:LoggedInUser,
        onlineUsers:onlineUsers
    })
   
  })


const server = require('http').createServer(app);
const io = require('socket.io')(server);
io.on('connection', socket=> {
 
    console.log("User Connected")
    socket.on('join', async (UserId) => {
      console.log("Received UserId:", UserId);
      try {
          const result = await UserModel.findOneAndUpdate(
              { _id: UserId },
              { socketId: socket.id }
          );
          console.log("Update result:", result); // Logs the document after the update
      } catch (error) {
          console.error("Error updating socketId:", error);
      }
      console.log(socket.id)
  });
  
    console.log(socket.id)
// disconnect is predefined in socket io 
    socket.on('disconnect',async()=>{
      await UserModel.findOneAndUpdate({
        socketId:socket.id
      },{
        socketId:null
      })
    })

    socket.on('message', (messageObject) => {
      console.log("Message received:", messageObject); // Log incoming message
      if (!messageObject.receiverId || !messageObject.message) {
          console.error("Invalid messageObject:", messageObject);
          return;
      }
      socket.to(messageObject.receiverId).emit('message', messageObject.message);
  });
  
});


server.listen(3000,()=>{
  console.log("Server is running ")
});


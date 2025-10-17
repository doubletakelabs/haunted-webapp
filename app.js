let express = require("express");
let app = express();
let server = require("http").createServer(app);
const cors = require("cors");
io = require("socket.io")(server, {
  handlePreflightRequest: (req, res) => {
    const headers = {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Origin": req.headers.origin, //or the specific origin you want to give access to,
      "Access-Control-Allow-Credentials": true,
    };
    res.writeHead(200, headers);
    res.end();
  },
});
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Get port from command line or use default
const port = process.argv[2] || 3000;

let triggeredEnd = false;
let audioPlaying = false;
let startTime = null;
let lastTrack = 4; // Track which track was assigned last (start with 4 so first visitor gets track 1)
let latestCommand = null; // Store the latest command sent to clients
let connectedUsers = {}; // Store connected users and their assigned tracks
let loopMode = false; // Track if we're in loop mode
let pausedTime = null; // Store the time when audio was paused for loop mode
let selectedLastHumanUser = null; // Store the user selected to hear lasthuman.mp3

app.use(cors());
app.use(cookieParser("doubletakelabs-haunted"));
app.use(express.json());

app.use(function (req, res, next) {
  var cookie = req.signedCookies["connect.sid"];
  if (cookie === undefined) {
    var randomNumber = Math.random().toString();
    randomNumber = randomNumber.substring(2, randomNumber.length);
    res.cookie("connect.sid", randomNumber, {
      maxAge: 7200000,
      httpOnly: false,
      signed: true,
    });
    //console.log('cookie created successfully');
  } else {
    // yes, cookie was already present
  }
  next(); // <-- important!
});

function getCookieID(str) {
  if (str == undefined) {
    return "none";
  }
  try {
    //console.log(str);
    let inputString = str.split("connect.sid=")[1];
    if (inputString && inputString.includes("; io")) {
      inputString = inputString.substring(0, inputString.indexOf(";"));
    } else if (inputString && inputString.includes("; Path")) {
      inputString = inputString.substring(0, inputString.indexOf(";"));
    } else {
      // No modification needed
    }
    return inputString || "none";
  } catch (error) {
    console.log(error);
    return "none";
  }
}

// Get track from cookie string
function getTrackFromCookie(str) {
  if (str == undefined) {
    return null;
  }
  try {
    const cookies = str.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'audioTrack') {
        return value;
      }
    }
    return null;
  } catch (error) {
    console.log(error);
    return null;
  }
}

// Simple event logging function (replaces database functionality)
function logEvent(userID, timestamp, event) {
  console.log(`User ${userID} at ${timestamp}: ${JSON.stringify(event)}`);
}

// Send playback status to admins
function updateAdminsWithPlaybackStatus() {
  let status = 'paused';
  let elapsedTime = 0;
  
  if (loopMode) {
    status = 'playingLoop';
    // In loop mode, we don't track elapsed time the same way
  } else if (audioPlaying && startTime) {
    if (triggeredEnd) {
      status = 'playingEnding';
    } else {
      status = 'playing';
    }
    
    const currentTime = Date.now();
    elapsedTime = (currentTime - startTime) / 1000; // Convert to seconds
  }
  
  io.to("admin").emit("playbackStatus", {
    status: status,
    elapsedTime: elapsedTime,
    isEndingTrack: triggeredEnd,
    isLoopMode: loopMode,
    pausedTime: pausedTime
  });
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static(`${__dirname}/public`));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, `${__dirname}/public/audio/`);
  },
  filename: function (req, file, cb) {
    // Use a temporary filename first, we'll rename it in the route handler
    cb(null, `temp_${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    // Check if file is audio
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Main route with persistent track assignment
app.get("/", function (req, res) {
  // Check if the experience has ended
  if (triggeredEnd) {
    // Clear the audioTrack cookie if the experience has ended
    res.clearCookie("audioTrack", { path: "/" });
    console.log("Cleared audioTrack cookie due to ended experience");
    res.sendFile(`${__dirname}/html/index.html`);
    return;
  }
  
  // Check if user already has an assigned track
  const existingTrack = req.cookies.audioTrack;
  
  if (!existingTrack) {
    // Assign a new track if the user doesn't have one
    lastTrack = lastTrack === 4 ? 1 : lastTrack + 1;
    
    // Set the track in a cookie
    res.cookie("audioTrack", lastTrack.toString(), { 
      maxAge: 7200000, 
      httpOnly: false,
      path: "/"
    });
    console.log(`New visitor assigned to track ${lastTrack}`);
  } else {
    console.log(`Returning visitor with track ${existingTrack}`);
  }
  
  res.sendFile(`${__dirname}/html/index.html`);
});

// Admin route
app.get("/admin", function (req, res) {
  res.sendFile(`${__dirname}/html/admin.html`);
});

// Upload route
app.get("/upload", function (req, res) {
  res.sendFile(`${__dirname}/html/upload.html`);
});

// Handle file upload
app.post("/upload", upload.single('audioFile'), function (req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }

    if (!req.body.trackNumber) {
      return res.status(400).json({ 
        success: false, 
        error: 'Track number is required' 
      });
    }

    const trackNumber = req.body.trackNumber;
    let finalFileName;
    
    // Validate track number/name
    if (trackNumber === 'end' || trackNumber === 'lasthuman' || trackNumber === 'loop') {
      finalFileName = `${trackNumber}.mp3`;
    } else {
      const trackNum = parseInt(trackNumber);
      if (trackNum < 1 || trackNum > 4) {
        return res.status(400).json({ 
          success: false, 
          error: 'Track must be 1-4, end, lasthuman, or loop' 
        });
      }
      finalFileName = `track${trackNum}.mp3`;
    }

    // Rename the uploaded file to the correct track name
    const tempFilePath = req.file.path;
    const finalFilePath = path.join(path.dirname(tempFilePath), finalFileName);
    
    // Remove existing track file if it exists
    if (fs.existsSync(finalFilePath)) {
      fs.unlinkSync(finalFilePath);
    }
    
    // Rename the temporary file to the final name
    fs.renameSync(tempFilePath, finalFilePath);

    console.log(`Successfully uploaded ${finalFileName}`);
    
    res.json({ 
      success: true, 
      message: `${finalFileName} uploaded successfully!`,
      filename: finalFileName,
      trackNumber: trackNumber
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Upload failed' 
    });
  }
});

// Error handling middleware for multer
app.use(function (error, req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        error: 'File too large. Maximum size is 50MB.' 
      });
    }
  }
  
  if (error.message === 'Only audio files are allowed!') {
    return res.status(400).json({ 
      success: false, 
      error: 'Only audio files are allowed!' 
    });
  }
  
  res.status(500).json({ 
    success: false, 
    error: error.message || 'Upload failed' 
  });
});

// Send current user list to admins
function updateAdminsWithUserList() {
  io.to("admin").emit("userList", connectedUsers);
}

io.on("connection", function (socket) {
  console.log("a visitor connected");
  
  // Get user ID from cookie
  let userID = getCookieID(socket.request.headers.cookie);
  let timestamp = new Date(new Date().toUTCString());
  
  // Check if this is an admin connection
  const isAdmin = socket.handshake.query.client === 'admin';
  
  if (isAdmin) {
    socket.join("admin");
    console.log("Admin connected");
    // Send current user list to the admin
    socket.emit("userList", connectedUsers);
    // Send current playback status to the admin
    updateAdminsWithPlaybackStatus();
  } else {
    socket.join("app");
    
    // Get track from cookie
    const track = getTrackFromCookie(socket.request.headers.cookie) || 'unassigned';
    
    // Store user info
    connectedUsers[socket.id] = {
      id: userID,
      track: track,
      connectedAt: timestamp.toLocaleString(),
      socketId: socket.id
    };
    
    // Notify admins about the new user
    updateAdminsWithUserList();
  }
  
  // Send current state to new connections
  // If audio is already playing, tell the new client to start playing at the correct time
  if (audioPlaying && startTime && !triggeredEnd) {
    const currentTime = Date.now();
    const elapsedTime = (currentTime - startTime) / 1000; // Convert to seconds
    socket.emit("playAudio", { startAt: elapsedTime });
  }

  if(audioPlaying && triggeredEnd){
    const currentTime = Date.now();
    const elapsedTime = (currentTime - startTime) / 1000; // Convert to seconds
    
    // Check if this user should hear lasthuman track
    if (socket.id === selectedLastHumanUser) {
      socket.emit("playLastHumanTrack", { startAt: elapsedTime });
    } else {
      socket.emit("playEndingTrack", { startAt: elapsedTime });
    }
  }

  logEvent(userID, timestamp, { event: "connected" });

  // Handle request for latest command
  socket.on("getLatestCommand", function() {
    console.log("Client requested latest command");
    
    if (latestCommand) {
      // If there's a latest command, calculate the current time offset
      if (startTime && (latestCommand.type === 'playAudio' || latestCommand.type === 'playEndingTrack')) {
        const currentTime = Date.now();
        const elapsedTime = (currentTime - startTime) / 1000; // Convert to seconds
        
        // Send the latest command with updated timing
        socket.emit(latestCommand.type, { startAt: elapsedTime });
        console.log(`Sent latest command ${latestCommand.type} with updated time: ${elapsedTime}s`);
      } else {
        // For commands without timing, just resend them
        socket.emit(latestCommand.type, latestCommand.data || {});
        console.log(`Sent latest command ${latestCommand.type}`);
      }
    } else {
      console.log("No latest command to send");
    }
  });

  // Update track information when client reports it
  socket.on("reportTrack", function(data) {
    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].track = data.track;
      updateAdminsWithUserList();
    }
  });

  socket.on("event", function (msg) {
    let user = getCookieID(socket.request.headers.cookie);
    let timestamp = new Date(new Date().toUTCString());
    logEvent(user, timestamp, msg.event);
  });

  socket.on("restart", function (msg) {
    console.log("experience restarted");
    triggeredEnd = false;
    loopMode = false;
    pausedTime = null;
    selectedLastHumanUser = null;
    // Don't automatically start audio playback
    audioPlaying = false;
    startTime = null;
    latestCommand = { type: 'restart' };
    io.in("app").emit("restart");
    io.in("app").emit("clearTrackCookie");
    // Update admin playback status
    updateAdminsWithPlaybackStatus();
  });
  
  // Handle play audio event from admin
  socket.on("playAudio", function (msg) {
    console.log("audio playback triggered by admin");
    audioPlaying = true;
    startTime = Date.now();
    latestCommand = { type: 'playAudio', data: { startAt: 0 } };
    io.in("app").emit("playAudio", { startAt: 0 });
    // Update admin playback status
    updateAdminsWithPlaybackStatus();
  });
  
  // Handle pause audio event from admin
  socket.on("pauseAudio", function (msg) {
    console.log("audio playback paused by admin");
    audioPlaying = false;
    startTime = null;
    latestCommand = { type: 'pauseAudio' };
    io.in("app").emit("pauseAudio");
    // Update admin playback status
    updateAdminsWithPlaybackStatus();
  });
  
  // Handle play ending track event from admin
  socket.on("playEndingTrack", function (msg) {
    console.log("ending track playback triggered by admin");
    
    // Randomly select one user to hear lasthuman.mp3
    const userSocketIds = Object.keys(connectedUsers);
    if (userSocketIds.length > 0) {
      const randomIndex = Math.floor(Math.random() * userSocketIds.length);
      selectedLastHumanUser = userSocketIds[randomIndex];
      console.log(`Selected user ${selectedLastHumanUser} to hear lasthuman.mp3`);
    } else {
      selectedLastHumanUser = null;
      console.log("No users connected, no lasthuman selection");
    }
    
    startTime = Date.now();
    audioPlaying = true;
    triggeredEnd = true;
    
    // Send different tracks to different users
    Object.keys(connectedUsers).forEach(userSocketId => {
      if (userSocketId === selectedLastHumanUser) {
        // Send lasthuman track to selected user
        io.to(userSocketId).emit("playLastHumanTrack", { startAt: 0 });
        console.log(`Sent lasthuman track to user ${userSocketId}`);
      } else {
        // Send ending track to all other users
        io.to(userSocketId).emit("playEndingTrack", { startAt: 0 });
        console.log(`Sent ending track to user ${userSocketId}`);
      }
    });
    
    latestCommand = { type: 'playEndingTrack', data: { startAt: 0 } };
    // Update admin playback status
    updateAdminsWithPlaybackStatus();
  });

  // Handle play loop track event from admin
  socket.on("playLoopTrack", function (msg) {
    console.log("loop track playback triggered by admin");
    
    // Store the current playback time if audio is playing
    if (audioPlaying && startTime) {
      const currentTime = Date.now();
      pausedTime = (currentTime - startTime) / 1000; // Convert to seconds
      console.log(`Paused main audio at ${pausedTime} seconds`);
    } else {
      console.log("No audio was playing, pausedTime remains null");
    }
    
    // Set loop mode
    loopMode = true;
    audioPlaying = true;
    startTime = Date.now();
    latestCommand = { type: 'playLoopTrack', data: { startAt: 0 } };
    
    io.in("app").emit("playLoopTrack", { startAt: 0 });
    // Update admin playback status
    updateAdminsWithPlaybackStatus();
  });

  // Handle return from loop track event from admin
  socket.on("returnFromLoop", function (msg) {
    console.log("return from loop track triggered by admin");
    
    // Exit loop mode
    loopMode = false;
    
    // Resume from where we left off
    if (pausedTime !== null) {
      console.log(`Resuming from paused time: ${pausedTime} seconds`);
      startTime = Date.now() - (pausedTime * 1000);
      const resumeTime = pausedTime;
      pausedTime = null; // Clear the paused time after using it
      
      audioPlaying = true;
      latestCommand = { type: 'returnFromLoop', data: { startAt: resumeTime } };
      
      io.in("app").emit("returnFromLoop", { startAt: resumeTime });
    } else {
      console.log("No paused time available, starting from beginning");
      // If no paused time, start from beginning
      startTime = Date.now();
      audioPlaying = true;
      latestCommand = { type: 'returnFromLoop', data: { startAt: 0 } };
      
      io.in("app").emit("returnFromLoop", { startAt: 0 });
    }
    
    // Update admin playback status
    updateAdminsWithPlaybackStatus();
  });

  socket.on("disconnect", function () {
    console.log("a visitor disconnected");
    
    // Remove user from connected users
    if (connectedUsers[socket.id]) {
      delete connectedUsers[socket.id];
      // Update admins with the new user list
      updateAdminsWithUserList();
    }
    
    let event = { event: "disconnected" };
    let user = getCookieID(socket.request.headers.cookie);
    let timestamp = new Date(new Date().toUTCString());
    logEvent(user, timestamp, event);
  });
});

// Set up a timer to periodically update admin playback status
setInterval(updateAdminsWithPlaybackStatus, 5000);

server.listen(parseInt(port), function () {
  console.log(`Haunted House server listening on port ${port}`);
});

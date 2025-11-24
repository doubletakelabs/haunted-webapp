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
let lastTrack = 6; // Start with 6 so first visitor gets 1
const TOTAL_TEAMS = 6;

let latestCommand = null; // Store the latest command sent to clients
let connectedUsers = {}; // Store connected users and their assigned tracks
let loopMode = false; // Track if we're in loop mode
let pausedTime = null; // Store the time when audio was paused for loop mode

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
  } else {
    // yes, cookie was already present
  }
  next(); 
});

function getCookieID(str) {
  if (str == undefined) {
    return "none";
  }
  try {
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
  } else if (audioPlaying && startTime) {
    status = 'playing';
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

// Helper to list audio files
function getAudioFiles() {
  const audioDir = path.join(__dirname, 'public/audio');
  try {
    const files = fs.readdirSync(audioDir);
    return files.filter(file => file.endsWith('.mp3'));
  } catch (err) {
    console.error("Error reading audio directory:", err);
    return [];
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static(`${__dirname}/public`));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, `${__dirname}/public/audio/`);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
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
  // Check if user already has an assigned track
  const existingTrack = req.cookies.audioTrack;
  
  if (!existingTrack) {
    // Assign a new track if the user doesn't have one
    // Cycle 1 through TOTAL_TEAMS
    lastTrack = lastTrack === TOTAL_TEAMS ? 1 : lastTrack + 1;
    
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

// Handle file upload - Updated for generic uploads
app.post("/upload", upload.single('audioFile'), function (req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    // Just accept the file as is (multer storage handles it)
    res.json({ 
      success: true, 
      message: `${req.file.originalname} uploaded successfully!`,
      filename: req.file.originalname
    });
    // Notify admin of new file
    io.to("admin").emit("audioFilesList", getAudioFiles());

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: error.message || 'Upload failed' });
  }
});

// Send current user list to admins
function updateAdminsWithUserList() {
  io.to("admin").emit("userList", connectedUsers);
}

io.on("connection", function (socket) {
  console.log("a visitor connected");
  
  let userID = getCookieID(socket.request.headers.cookie);
  let timestamp = new Date(new Date().toUTCString());
  
  // Check if this is an admin connection
  const isAdmin = socket.handshake.query.client === 'admin';
  
  if (isAdmin) {
    socket.join("admin");
    console.log("Admin connected");
    socket.emit("userList", connectedUsers);
    socket.emit("playbackStatus", { status: audioPlaying ? 'playing' : 'paused' });
    socket.emit("audioFilesList", getAudioFiles());
    updateAdminsWithPlaybackStatus();
  } else {
    socket.join("app");
    
    const track = getTrackFromCookie(socket.request.headers.cookie) || 'unassigned';
    
    connectedUsers[socket.id] = {
      id: userID,
      track: track, // This is effectively the Group ID (1-6)
      connectedAt: timestamp.toLocaleString(),
      socketId: socket.id
    };
    
    updateAdminsWithUserList();
  }
  
  // Sync new user to current state
  if (audioPlaying && startTime && !triggeredEnd) {
    const currentTime = Date.now();
    const elapsedTime = (currentTime - startTime) / 1000;
    socket.emit("playStem", { startAt: elapsedTime });
  }

  logEvent(userID, timestamp, { event: "connected" });

  // Admin Commands
  socket.on("getAudioFiles", () => {
    socket.emit("audioFilesList", getAudioFiles());
  });

  socket.on("sortPlayers", () => {
    console.log("Sorting players evenly...");
    const userIds = Object.keys(connectedUsers);
    const users = Object.values(connectedUsers);
    
    // Shuffle
    for (let i = users.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [users[i], users[j]] = [users[j], users[i]];
    }

    // Distribute
    users.forEach((user, index) => {
      const newGroup = (index % TOTAL_TEAMS) + 1;
      user.track = newGroup.toString();
      connectedUsers[user.socketId].track = newGroup.toString(); // Update main store
      
      // Update the user's client
      io.to(user.socketId).emit("setGroup", { group: newGroup });
    });

    updateAdminsWithUserList();
  });

  socket.on("updateUserGroup", (data) => {
    // data: { socketId, group }
    if (connectedUsers[data.socketId]) {
      connectedUsers[data.socketId].track = data.group.toString();
      io.to(data.socketId).emit("setGroup", { group: data.group });
      updateAdminsWithUserList();
    }
  });

  // Play a specific file for specific targets (Interruption)
  socket.on("applyAudio", (data) => {
    // data: { targets: [socketId1, socketId2...], filename: "x.mp3", isLastClip: boolean }
    console.log("Applying audio:", data);
    if (!data.targets || !data.filename) return;

    data.targets.forEach(targetId => {
       io.to(targetId).emit("playTrigger", { 
           filename: data.filename,
           isLastClip: data.isLastClip 
       });
    });
  });

  socket.on("stopAudio", (data) => {
    // data: { targets: [socketId...] }
    if (!data.targets) return;
    data.targets.forEach(targetId => {
        io.to(targetId).emit("stopTrigger");
    });
  });

  // Global Stem Controls
  socket.on("playStem", () => {
    console.log("Playing stems");
    audioPlaying = true;
    startTime = Date.now();
    io.in("app").emit("playStem", { startAt: 0 });
    updateAdminsWithPlaybackStatus();
  });

  socket.on("pauseStem", () => {
    console.log("Pausing stems");
    audioPlaying = false;
    startTime = null; // Or keep track of pause time for resume? The old app reset on pause? 
    // Spec says "Stem pauses -> Trigger plays -> Stem resumes".
    // But also "Facilitator can... Pause, Resume".
    // Standard Pause usually holds position.
    // For now, let's assume simple pause.
    io.in("app").emit("pauseStem");
    updateAdminsWithPlaybackStatus();
  });
  
  // Periodic Sync Pulse to keep everyone aligned
  setInterval(() => {
    if (audioPlaying && startTime) {
       const currentTime = Date.now();
       const elapsedTime = (currentTime - startTime) / 1000;
       io.in("app").emit("sync", { elapsedTime: elapsedTime });
    }
  }, 4000);
  
  socket.on("resumeStem", () => {
     // If we need to resume from a specific time, we need to track pausedTime globally like before.
     // Re-implementing the pause tracking logic from original app simplified.
     if (pausedTime) {
         // Resume logic
     }
  });

  // Resume Stem Logic (Global)
  socket.on("globalResume", () => {
      // This command implies everyone should resume their main stem from where they were, or sync to server time?
      // The prompt says "Stem pauses -> Trigger plays -> Stem resumes where it left off."
      // This implies the CLIENT tracks where it left off, or the server tracks global time.
      // Since stems are synced, server time is best.
      // If the whole experience was Paused (startTime cleared), we need a new startTime offset.
  });

  socket.on("resetExperience", () => {
    console.log("Resetting experience...");
    triggeredEnd = false;
    audioPlaying = false;
    startTime = null;
    loopMode = false;
    pausedTime = null;
    latestCommand = null;
    
    // Notify all clients to reset
    io.emit("resetClient");
    
    updateAdminsWithPlaybackStatus();
  });

  socket.on("reportStatus", function(data) {
    // data: { state, file, time, duration }
    if (connectedUsers[socket.id]) {
       // Update server state
       connectedUsers[socket.id].status = data;
       
       // Relay specific user update to admin to avoid full list spam
       io.to("admin").emit("userStatusUpdate", { 
           socketId: socket.id, 
           status: data 
       });
    }
  });

  socket.on("disconnect", function () {
    if (connectedUsers[socket.id]) {
      delete connectedUsers[socket.id];
      updateAdminsWithUserList();
    }
    let user = getCookieID(socket.request.headers.cookie);
    let timestamp = new Date(new Date().toUTCString());
    logEvent(user, timestamp, { event: "disconnected" });
  });
});

server.listen(parseInt(port), function () {
  console.log(`Last Human server listening on port ${port}`);
});

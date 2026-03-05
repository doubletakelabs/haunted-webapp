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
  pingTimeout: 60000, // 60 seconds - longer timeout for mobile devices
  pingInterval: 25000, // 25 seconds - send ping every 25 seconds
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
let TOTAL_TEAMS = 6;

let latestCommand = null; // Store the latest command sent to clients
let connectedUsers = {}; // Store connected users and their assigned tracks
let loopMode = false; // Track if we're in loop mode
let pausedTime = null; // Store the time when audio was paused for loop mode
let groupTracks = {}; // { "1": "track1.mp3", "2": "track2.mp3", ... }
let hiddenFiles = new Set(); // Set of filenames that are hidden
let backgroundTrack = null; // Filename for background track (plays when main tracks paused)

// Initialize default tracks
for(let i=1; i<=6; i++) {
    groupTracks[i.toString()] = `track${i}.mp3`;
}

app.use(cors());
app.use(cookieParser("doubletakelabs-haunted"));
app.use(express.json({ limit: '500mb' }));

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

app.use(express.urlencoded({ extended: true, limit: '500mb' }));
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
    fileSize: 500 * 1024 * 1024 // 500MB limit
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
    if (lastTrack > TOTAL_TEAMS) lastTrack = 1; // Safety check if TOTAL_TEAMS reduced
    
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
    socket.emit("hiddenFilesUpdate", Array.from(hiddenFiles)); // Send hidden files list
    socket.emit("groupCountUpdate", { count: TOTAL_TEAMS }); // Send current group count
    socket.emit("groupTracksUpdate", groupTracks); // Send current track assignments
    socket.emit("backgroundTrackUpdate", { filename: backgroundTrack }); // Send current background track
    updateAdminsWithPlaybackStatus();
  } else {
    socket.join("app");
    
    const track = getTrackFromCookie(socket.request.headers.cookie) || 'unassigned';
    
    connectedUsers[socket.id] = {
      id: userID,
      track: track, // This is effectively the Group ID (1-6)
      connectedAt: timestamp.toLocaleString(),
      socketId: socket.id,
      triggerHistory: []
    };
    
    // Send assigned track filename to client immediately
    if (track !== 'unassigned' && groupTracks[track]) {
        socket.emit("setTrack", { filename: groupTracks[track] });
    }
    
    updateAdminsWithUserList();
  }
  
  // Sync new user to current state
  if (audioPlaying && startTime && !triggeredEnd) {
    const currentTime = Date.now();
    const elapsedTime = (currentTime - startTime) / 1000;
    console.log(`Syncing new user to ${elapsedTime}s`);
    socket.emit("playStem", { startAt: elapsedTime });
  } else if (pausedTime !== null) {
      // If paused, tell client where to be
      console.log(`Syncing new user to paused time ${pausedTime}s`);
      socket.emit("sync", { elapsedTime: pausedTime, isPaused: true });
  }

  logEvent(userID, timestamp, { event: "connected" });

  // Handle keepalive ping from client
  socket.on("ping", () => {
    socket.emit("pong");
  });

  // Handle request for latest command
  socket.on("getLatestCommand", function() {
    console.log("Client requested latest command");
    if (latestCommand) {
      console.log("Sending latest command to client:", latestCommand.type);
      if (latestCommand.type === 'playStem' && audioPlaying && startTime) {
          // Recalculate time for accurate sync
          const currentTime = Date.now();
          const elapsedTime = (currentTime - startTime) / 1000;
          socket.emit('playStem', { startAt: elapsedTime });
      } else if (latestCommand.type === 'pauseStem') {
          socket.emit('pauseStem');
      } else {
          socket.emit(latestCommand.type, latestCommand.data || {});
      }
    } else {
        // If no latest command, ensure client is paused/reset
        socket.emit('resetClient');
    }
  });

  // Admin Commands
  socket.on("getAudioFiles", () => {
    socket.emit("audioFilesList", getAudioFiles());
    socket.emit("hiddenFilesUpdate", Array.from(hiddenFiles));
  });

  socket.on("toggleHideAudioFile", (filename) => {
      if (hiddenFiles.has(filename)) {
          hiddenFiles.delete(filename);
      } else {
          hiddenFiles.add(filename);
      }
      io.to("admin").emit("hiddenFilesUpdate", Array.from(hiddenFiles));
  });

  socket.on("deleteAudioFile", (filename) => {
      if (!filename) return;
      const filePath = path.join(__dirname, 'public/audio', filename);
      
      // Security check: prevent directory traversal
      if (path.basename(filePath) !== filename) {
          console.error("Invalid filename for deletion");
          return;
      }
      
      try {
          if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`Deleted file: ${filename}`);
              // Update lists
              io.to("admin").emit("audioFilesList", getAudioFiles());
          }
      } catch (err) {
          console.error("Error deleting file:", err);
      }
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
      io.to(user.socketId).emit("setGroup", { 
          group: newGroup,
          filename: groupTracks[newGroup.toString()] 
      });
    });

    updateAdminsWithUserList();
  });

  socket.on("updateUserGroup", (data) => {
    // data: { socketId, group }
    if (connectedUsers[data.socketId]) {
      connectedUsers[data.socketId].track = data.group.toString();
      io.to(data.socketId).emit("setGroup", { 
          group: data.group,
          filename: groupTracks[data.group.toString()]
      });
      updateAdminsWithUserList();
    }
  });
  
  socket.on("updateGroupTrack", (data) => {
      // data: { groupId, filename }
      if (data.groupId && data.filename) {
          groupTracks[data.groupId] = data.filename;
          console.log(`Updated Group ${data.groupId} to play ${data.filename}`);
          
          // Notify admins
          io.to("admin").emit("groupTracksUpdate", groupTracks);
          
          // Notify clients in that group to switch tracks
          // Find all users in this group
          const userIds = Object.keys(connectedUsers);
          userIds.forEach(id => {
             if (connectedUsers[id].track === data.groupId.toString()) {
                 io.to(id).emit("setTrack", { filename: data.filename });
             } 
          });
      }
  });

  // Set Background Track
  socket.on("setBackgroundTrack", (data) => {
      // data: { filename } or { filename: null } to clear
      backgroundTrack = data.filename || null;
      console.log(`Background track set to: ${backgroundTrack || 'none'}`);
      
      // Notify all admins
      io.to("admin").emit("backgroundTrackUpdate", { filename: backgroundTrack });
      
      // Notify all clients of the new background track
      io.in("app").emit("setBackgroundTrack", { filename: backgroundTrack });
  });

  // Load Cue (Pending Trigger)
  socket.on("loadCue", (data) => {
      // data: { targets: [socketId...], filename: "x.mp3", isLastClip: boolean }
      console.log("Loading cue:", data);
      if (!data.targets || !data.filename) return;

      data.targets.forEach(targetId => {
          if (connectedUsers[targetId]) {
              connectedUsers[targetId].cuedTrack = {
                  filename: data.filename,
                  isLastClip: data.isLastClip
              };
          }
      });
      
      updateAdminsWithUserList();
  });

  // Trigger All Cues
  socket.on("triggerAllCues", () => {
      console.log("Triggering all cues...");
      let triggeredCount = 0;
      
      Object.keys(connectedUsers).forEach(socketId => {
          const user = connectedUsers[socketId];
          if (user.cuedTrack) {
              // Send trigger (client handles stopping background track locally)
              io.to(socketId).emit("playTrigger", { 
                  filename: user.cuedTrack.filename,
                  isLastClip: user.cuedTrack.isLastClip 
              });
              
              // Add to history
              if (!user.triggerHistory) user.triggerHistory = [];
              user.triggerHistory.push(user.cuedTrack.filename);
              
              // Clear cue
              delete user.cuedTrack;
              triggeredCount++;
          }
      });
      
      if (triggeredCount > 0) {
          updateAdminsWithUserList();
      }
  });

  // Clear Cues
  socket.on("clearCues", (data) => {
      // data: { targets: [socketId...] } or if null, clear all? Let's do targets.
      if (!data || !data.targets) return;
      
      data.targets.forEach(targetId => {
          if (connectedUsers[targetId] && connectedUsers[targetId].cuedTrack) {
              delete connectedUsers[targetId].cuedTrack;
          }
      });
      
      updateAdminsWithUserList();
  });

  // Play a specific file for specific targets (Interruption) - Keeping for backward compat if needed, but Load/Trigger is new way
  socket.on("applyAudio", (data) => {
    // data: { targets: [socketId1, socketId2...], filename: "x.mp3", isLastClip: boolean }
    console.log("Applying audio:", data);
    if (!data.targets || !data.filename) return;

    data.targets.forEach(targetId => {
       io.to(targetId).emit("playTrigger", { 
           filename: data.filename,
           isLastClip: data.isLastClip 
       });
       
       // Update history for direct apply
       if (connectedUsers[targetId]) {
           if (!connectedUsers[targetId].triggerHistory) connectedUsers[targetId].triggerHistory = [];
           connectedUsers[targetId].triggerHistory.push(data.filename);
       }
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
    
    // Stop background track if playing
    io.in("app").emit("stopBackgroundTrack");
    
    let startOffset = 0;
    if (pausedTime !== null) {
        // Resume from pause
        startOffset = pausedTime;
        startTime = Date.now() - (pausedTime * 1000);
        pausedTime = null; // Clear paused state after resuming
    } else {
        // Start from beginning
        startTime = Date.now();
    }
    
    latestCommand = { type: 'playStem', data: { startAt: startOffset } };
    
    io.in("app").emit("playStem", { startAt: startOffset });
    updateAdminsWithPlaybackStatus();
  });

  socket.on("pauseStem", () => {
    console.log("Pausing stems");
    
    // Calculate/Save pause time before clearing startTime
    if (audioPlaying && startTime) {
        const currentTime = Date.now();
        pausedTime = (currentTime - startTime) / 1000;
    }
    
    audioPlaying = false;
    startTime = null;
    
    latestCommand = { type: 'pauseStem' };
    
    io.in("app").emit("pauseStem");
    
    // Start background track if one is set
    if (backgroundTrack) {
        io.in("app").emit("playBackgroundTrack", { filename: backgroundTrack });
    }
    
    updateAdminsWithPlaybackStatus();
  });
  
  // Periodic Sync Pulse to keep everyone aligned
  setInterval(() => {
    if (audioPlaying && startTime) {
       const currentTime = Date.now();
       const elapsedTime = (currentTime - startTime) / 1000;
       
       // Sync clients
       io.in("app").emit("sync", { elapsedTime: elapsedTime });
       
       // Update admin timer live
       io.to("admin").emit("playbackStatus", {
        status: 'playing',
        elapsedTime: elapsedTime,
        isEndingTrack: triggeredEnd,
        isLoopMode: loopMode,
        pausedTime: pausedTime
      });
    }
  }, 1000); // Changed from 4000 to 1000 for smoother admin UI updates
  
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
    
    // Stop background track on reset
    io.in("app").emit("stopBackgroundTrack");
    
    // Notify all clients to reset
    io.emit("resetClient");
    
    // Clear Trigger History for all users
    Object.values(connectedUsers).forEach(user => {
        user.triggerHistory = [];
    });
    updateAdminsWithUserList();
    
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

  socket.on("updateGroupCount", (data) => {
      if (data.count && data.count >= 1 && data.count <= 6) {
          TOTAL_TEAMS = data.count;
          lastTrack = TOTAL_TEAMS; // Reset round robin
          console.log(`Group count updated to ${TOTAL_TEAMS}`);
          
          // Trigger Full Reset
          triggeredEnd = false;
          audioPlaying = false;
          startTime = null;
          loopMode = false;
          pausedTime = null;
          latestCommand = null;
          
          // Re-assign all current users to fit new group count
          // Just shuffle them all
          const userIds = Object.keys(connectedUsers);
          userIds.forEach((socketId, index) => {
              const newGroup = (index % TOTAL_TEAMS) + 1;
              connectedUsers[socketId].track = newGroup.toString();
              io.to(socketId).emit("setGroup", { 
                  group: newGroup,
                  filename: groupTracks[newGroup.toString()] 
              });
          });
          
          // Notify admin of new count
          io.to("admin").emit("groupCountUpdate", { count: TOTAL_TEAMS });
          
          // Notify everyone to reset/refresh
          io.emit("resetClient"); // Stop audio
          io.emit("forceRefresh"); // Reload page to ensure clean state and new audio files loaded
          
          updateAdminsWithUserList();
          updateAdminsWithPlaybackStatus();
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

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

// Get port from command line or use default
const port = process.argv[2] || 3000;

let triggeredEnd = false;
let audioPlaying = false;
let startTime = null;
let lastTrack = 2; // Track which track was assigned last (start with 2 so first visitor gets track 1)
let latestCommand = null; // Store the latest command sent to clients
let connectedUsers = {}; // Store connected users and their assigned tracks

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
  
  if (audioPlaying && startTime) {
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
    isEndingTrack: triggeredEnd
  });
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static(`${__dirname}/public`));

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
    lastTrack = lastTrack === 1 ? 2 : 1;
    
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
    socket.emit("playEndingTrack", { startAt: elapsedTime });
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
    startTime = Date.now();
    audioPlaying = true;
    latestCommand = { type: 'playEndingTrack', data: { startAt: 0 } };
    io.in("app").emit("playEndingTrack", { startAt: 0 });
    triggeredEnd = true;
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

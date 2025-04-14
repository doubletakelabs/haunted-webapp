// Connect to socket.io
const socket = io();

// DOM Elements - Wait for document to load before accessing
let installPrompt;
let titleScreen; 
let gameContainer;
let roleTitle;
let roleInstructions;
let progressFill;
let percentDisplay;
let startButton;

// Game state
let currentRole = null;
let gamePhase = 'title';
let progress = 0;
let progressInterval = null;
let p5Instance = null;

// Flag to track if this user is the last human
let isLastHuman = false;

// Check if running as PWA
function isRunningAsPWA() {
  return (window.matchMedia('(display-mode: standalone)').matches) || 
         (window.navigator.standalone) || 
         (document.referrer.includes('android-app://'));
}

// Initialize all DOM elements
function initializeElements() {
  installPrompt = document.getElementById('installPrompt');
  titleScreen = document.getElementById('titleScreen');
  gameContainer = document.getElementById('gameContainer');
  roleTitle = document.getElementById('roleTitle');
  roleInstructions = document.getElementById('roleInstructions');
  progressFill = document.getElementById('progressFill');
  percentDisplay = document.getElementById('percentDisplay');
  startButton = document.getElementById('startButton');
  
  if (!installPrompt || !titleScreen || !gameContainer) {
    console.error('Critical elements missing from DOM');
    return false;
  }
  
  return true;
}

// Handle installation prompt display
function setupInstallPrompt() {
  console.log('Setting up install prompt');
  
  // Make sure canvas is not covering the prompt - remove any existing canvas
  const canvases = document.getElementsByTagName('canvas');
  for (let i = 0; i < canvases.length; i++) {
    canvases[i].remove();
  }
  
  // If running as PWA or previously dismissed, show title screen
  if (isRunningAsPWA() || localStorage.getItem('dismissedInstallPrompt') === 'true') {
    console.log('Skipping install prompt (PWA or dismissed)');
    installPrompt.style.display = 'none';
    titleScreen.style.display = 'flex';
  } else {
    // Otherwise show install prompt
    console.log('Showing install prompt');
    installPrompt.style.display = 'flex';
    titleScreen.style.display = 'none';
  }
  
  // Ensure game container is hidden
  gameContainer.style.display = 'none';
}

// Initialize P5.js
function initP5() {
  if (!p5Instance) {
    console.log('Initializing P5.js');
    p5Instance = new p5();
  }
}

// Get role from cookie
function getRoleFromCookie() {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'hvbRole') {
      return value;
    }
  }
  return null;
}

// Start the game
function startGame() {
  // Get role from cookie
  currentRole = getRoleFromCookie();
  
  if (!currentRole) {
    console.error('No role assigned by server');
    return;
  }
  
  // Report role to server
  socket.emit('reportRole', { role: currentRole });
  
  // Update UI
  titleScreen.style.display = 'none';
  gameContainer.style.display = 'flex';
  document.body.style.fontSize = '100%';
  
  roleTitle.textContent = `Your Role: ${currentRole}`;
  roleInstructions.textContent =
    currentRole === 'Human'
      ? 'Keep this secret. You are a HUMAN. Pretend to be a BOT at all times. Mimic responses 100%.'
      : currentRole === 'Bot'
      ? 'Keep this secret. You are a BOT. Pretend to be HUMAN 50% of the time. Keep this secret.'
      : 'Keep this secret. You are GLITCHED. Pretend to glitch at random moments throughout the game.';
  
  // Start progress bar
  runLoadingBar(currentRole);
}

// Start progress bar animation
function startProgressBar() {
  progress = 0;
  if (progressInterval) clearInterval(progressInterval);
  
  progressInterval = setInterval(() => {
    progress += 0.5;
    if (progress >= 100) {
      clearInterval(progressInterval);
      showRoundOne();
    }
    
    progressFill.style.width = `${progress}%`;
    percentDisplay.textContent = `Loading... ${Math.floor(progress)}%`;
  }, 50);
}

// Show round one
function showRoundOne() {
  // Implement round one logic here
  console.log('Starting round one');
}

// Socket event listeners
socket.on('clearRoleCookie', () => {
  document.cookie = 'hvbRole=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
});

socket.on('forceRefresh', () => {
  window.location.reload();
});

socket.on('youAreLastHuman', () => {
  console.log('You have been chosen as the Last Human');
  isLastHuman = true;
});

// Function to dismiss the install prompt
function dismissInstallPrompt() {
  console.log('Dismissing install prompt');
  installPrompt.style.display = 'none';
  localStorage.setItem('dismissedInstallPrompt', 'true');
  titleScreen.style.display = 'flex';
  
  // Initialize P5.js after prompt is dismissed
  setTimeout(initP5, 100);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded fired');
  
  // Initialize DOM elements first
  if (initializeElements()) {
    // Setup the install prompt 
    setupInstallPrompt();
    
    // Add event listeners
    startButton.addEventListener('click', startGame);
    
    // Add dismiss install prompt button listener
    const dismissButton = document.getElementById('dismissInstallPrompt');
    if (dismissButton) {
      dismissButton.addEventListener('click', dismissInstallPrompt);
    }
    
    // Request wake lock
    requestWakeLock();
    
    // Do NOT initialize P5.js here - it will be initialized after prompt is dismissed
  }
});

// Add event listener to the close button on install prompt
document.addEventListener('click', (event) => {
  // Check if the click was on the close button in the install prompt
  if (event.target.tagName === 'BUTTON' && 
      event.target.parentElement === installPrompt) {
    // Initialize P5 after prompt is dismissed
    setTimeout(initP5, 100);
  }
});

let assignedRole = '';

// ========== WAKE LOCK: Prevent screen from dimming or sleeping ========== 
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock released');
      });
      console.log('Wake Lock is active');
    }
  } catch (err) {
    console.error(`${err.name}, ${err.message}`);
  }
}

document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

window.addEventListener('load', requestWakeLock);

const platform = (() => {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document)) {
    return 'iOS';
  } else if (/android/i.test(navigator.userAgent)) {
    return 'Android';
  }
  return 'Other';
})();

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

function showHomeScreenPrompt() {
  const prompt = document.getElementById('homescreenPrompt');
  if (prompt) prompt.style.display = 'flex';
}

function runLoadingBar(role) {
  const fill = document.getElementById('progressFill');
  const display = document.getElementById('percentDisplay');
  const duration = 30000;
  const start = Date.now();

  const interval = setInterval(() => {
    const elapsed = Date.now() - start;
    const percent = Math.min(100, Math.round((elapsed / duration) * 100));
    fill.style.width = `${percent}%`;
    display.textContent = `Loading... ${percent}%`;

    if (elapsed >= duration) {
      clearInterval(interval);
      display.textContent = 'Complete!';
      document.body.style.fontSize = '115%';
      setTimeout(() => startNextPhase(), 1000);
      //setTimeout(() => showRoundThree(), 1000);
    }
  }, 100);
}

function startNextPhase() {
  const container = document.getElementById('gameContainer');
  container.innerHTML = `
    <h2>FIND A PARTNER</h2>
    <p>Quickly find someone you trust. Face them.</p>
    <button onclick="showForeheadCountdown()">Continue</button>
    </pre>
  `;
}

function showForeheadCountdown() {
  let seconds = 25;
  const container = document.getElementById('gameContainer');
  container.innerHTML = `
    <h2>HUMAN VS BOT</h2>
    <p>ROTATE your phone </strong><em>horizontally</em> and place it against your forehead. It's critical that your partner can see your screen at all times.</p>
    <p>Keep your phone on your forehead for the whole game.</p>
    <p id="countdown">${seconds}</p>
  `;
  const countdown = setInterval(() => {
    seconds--;
    document.getElementById('countdown').textContent = seconds;
    if (seconds <= 0) {
      clearInterval(countdown);
      showRoundOne();
    }
  }, 1000);
}

function showRoundOne() {
  const prompts = [
    "What's something you pretended to like because everyone else did?",
    "What's a post you wish you could take back, but can't?",
    "What's something you posted that wasn't true—but felt right?",
    "When did you realize a memory might have been edited?",
    "When did you last say 'I'm fine' and almost believe it?",
    "What's a part of you that only exists on a screen?",
    "Tell me one thing you deleted, but still think about.",
    "What's a truth you wish had gone viral?",
  ];
  
  // Use Fisher-Yates shuffle for better randomness
  function shuffle(array) {
    let currentIndex = array.length, temporaryValue, randomIndex;
    while (0 !== currentIndex) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]
      ];
    }
    return array;
  }

  const shuffled = shuffle([...prompts]);
  const selected = shuffled.slice(0, 3);
  let current = 0;
  const container = document.getElementById('gameContainer');

  function showNextPrompt() {
    if (current < selected.length) {
      container.innerHTML = `
        <h2>ROUND 1</h2>
        <div style="max-width: 500px; margin: 40px auto; font-size: 1.3em;"><strong>${selected[current]}</strong></div>
        <p style="margin-top: 20px; font-style: italic;">To avoid detection, do not stop talking.</> <p>ANSWER THE QUESTION AT THE SAME TIME AS YOUR PARTNER.</p>
      `;
      current++;
      setTimeout(() => {
        let countdown = 5;
        container.innerHTML = `<h2>Next Question In...</h2><p id="countdown" style="font-size: 3em; margin-top: 20px;">${countdown}</p>`;
        const interval = setInterval(() => {
          countdown--;
          document.getElementById('countdown').textContent = countdown;
          if (countdown <= 0) {
            clearInterval(interval);
            showNextPrompt();
          }
        }, 1000);
      }, 30000);
    } else {
      container.innerHTML = `
        <h2>ROUND 1</h2>
        <div style="font-size: 1.2em; margin: 30px auto; max-width: 600px;">
          <p>Confirm for your partner.</p> I confirm that every word was mined willingly from my shame. 
        </div>
        <button style="margin-top: 40px; font-size: 1.3em; padding: 16px 30px;" onclick="startCountdownToCircle()">👉 Tap here to continue</button>
      `;
    }
  }

  showNextPrompt();
}

function startCountdownToCircle() {
  const container = document.getElementById('gameContainer');
  container.innerHTML = `
    <h2>BECOME A GANG OF FOUR</h2>
    <p>Quickly find a pair of players closest to you. Form a gang of four. Get very close to each other. When you're ready count to 3 and everyone press ENTER on someone else's phone. </p>
    <button onclick="showEndScreen()">ENTER</button>
  `;
}

function showEndScreen() {
  const prompts = [
    "Mimic unlocking your phone with one hand—then act shocked by what you see. Don't say a word.",
    "Use one finger to endlessly scroll through an invisible feed. Make your face slowly melt with boredom.",
    "Wave at a fake video call with one hand—then freeze because you realized you're on mute.",
    "Perform the ancient ritual of trying to take a selfie with the wrong camera. React with dignified shame.",
    "Tap your temple with one finger like you're trying to refresh your brain. Don't stop until someone copies you.",
    "Hold your hand out like you're asking Siri for help. Then look betrayed when she misunderstands you.",
    "Make a slow-motion one-handed typing motion—like you're sending a risky text and instantly regretting it.",
    "Perform a one-handed 'shush' to your phone—like it just exposed your deepest secret.",
    "Use one hand to mime giving a thumbs-up... then glitch it into a thumbs-down, then sideways. Hold the error."
  ];
  const selected = prompts[Math.floor(Math.random() * prompts.length)];
  let seconds = 40;
  const container = document.getElementById('gameContainer');

  container.innerHTML = `
    <h2>ROUND 2</h2>
    <p style="font-size: 1.4em; max-width: 600px; margin: 20px auto;"><strong>${selected}</strong></p>
    <p id="round2Timer" style="font-size: 2.5em; margin-top: 20px;">${seconds}</p>
    <p style="margin-top: 20px; font-style: italic;">Perform this action and then do what's on other player's screens. To avoid detection always be moving.</p>
  `;

  const countdown = setInterval(() => {
    seconds--;
    document.getElementById('round2Timer').textContent = seconds;
    if (seconds <= 0) {
      clearInterval(countdown);
      showRoundThree();
    }
  }, 1000);
}

function showRoundThree() {
  const container = document.getElementById('gameContainer');
  container.innerHTML = '';

  const pre = document.createElement('pre');
  pre.style.position = 'fixed';
  pre.style.overflow = 'auto';
  pre.style.color = '#00ffcc';
  pre.style.fontSize = '.6em';
  pre.style.transition = 'opacity 1s ease-in-out';
  pre.style.opacity = '1';

  pre.innerHTML = `<img src="img/eye.jpeg" style="height: 95vh; object-fit: contain; margin: 0 auto;">`;

  let newHTML = `
  <p style="max-width: 600px; margin: 30px 0 auto; color: #00ffcc; text-wrap: auto;">1. Everyone take turns blinking your eyes and go around your gang 4 times.</h2>
  <pre id="eyegraphic" style="white-space: pre-wrap;">
▒▒                      
██          ██            
  ██        ████          ████            
  ██      ████      ██████        ██████              
██    ██    ██    ████      ██████          ██████                
██  ██████████████████████████████████        ████████                  
██████████████████████████████████████      ██████████        ██            
██████████████████████████████████████████████████████        ██          ██  
█████████████████████████████████████████████████████            ██        ██    
█████████████████████████████████████████████████████████        ██        ████    
██████████████████▓▓▓▓▓▓▓▓▓▓██████░░▒▒██████████████████████████      ██████      
██████████████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓████░░░░████████████████████████    ████████        
████████████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██░░░░░░██████████████████████████████          
████████████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██░░░░░░██████████████████████████        ██  
████████████▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒░░    ▓▓▓▓▓▓██░░░░░░░░░░████████████████████        ██    
████████░░██▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒░░▒▒░░          ▓▓▓▓▓▓██  ░░░░░░░░████████████████      ████      
██████▒▒░░██▓▓▓▓▓▓▒▒▒▒░░░░▒▒██████          ▓▓▓▓▓▓██    ░░░░░░░░████████████████████        ██
████░░░░░░██▓▓▓▓▓▓▒▒░░▒▒▒▒████████          ▒▒▓▓▓▓██      ░░░░░░░░██████████████          ████
██████░░  ██▓▓▓▓▓▓▓▓▒▒▒▒▒▒████████████      ▒▒▒▒▒▒▓▓▓▓██      ░░░░░░░░██████████      ████████  
████░░    ██▓▓▓▓▓▓▒▒▓▓▒▒██████████████████▒▒░░░░░░▒▒▒▒██        ░░░░░░░░████████████████████    
████░░    ██▓▓▓▓▓▓▒▒░░░░██████████████████▒▒▒▒▒▒░░▒▒▒▒██          ░░░░░░████████████████        
████      ██▓▓▓▓▓▓▒▒░░▒▒██████████████████▒▒░░░░▒▒▓▓▒▒██          ░░░░░░██████████████          
██░░      ██▓▓▓▓▒▒░░▒▒░░▒▒██████████████▒▒░░▒▒░░▒▒░░▒▒██            ░░████████████        ██    
██          ██▓▓░░▒▒▒▒░░░░▒▒██████████▒▒▒▒░░▒▒░░▒▒▒▒██              ░░██████████      ████      
██░░░░        ██▓▓▒▒░░▒▒░░▒▒▒▒░░██████▒▒░░▒▒░░░░░░▓▓▒▒██            ░░██████████████████          
██░░░░        ██▓▓▓▓▒▒░░▒▒░░░░░░▒▒▒▒▒▒▒▒░░▒▒░░▒▒░░▒▒▒▒██          ░░████████████████              
██░░░░          ██▓▓▒▒░░░░▒▒░░▒▒▒▒░░▒▒░░▓▓░░░░░░▒▒▒▒██          ░░░░██████████      ██            
██░░░░          ██▒▒▒▒▒▒▒▒░░░░▒▒░░░░▒▒░░░░▒▒▒▒░░▒▒▒▒██          ░░██████████    ████              
██░░              ██▒▒▒▒░░▒▒▓▓░░▒▒░░░░▓▓░░▒▒▓▓▒▒▒▒██          ░░░░██████████████                  
██████            ████▒▒▒▒▒▒░░▒▒▒▒▓▓▒▒▒▒▒▒▒▒████            ░░████████                          
  ████              ██████▒▒▒▒▒▒▒▒▒▒██████              ░░██████                              
    ██████                ██████████                ░░░░████████████                          
      ████████                                  ░░░░████████                                  
          ██████████                      ░░░░░░████████                                      
              ████████████░░░░░░░░░░░░░░░░██████████                                          
                    ████████████████████████████                                              
                    ░░░░░░████████████████░░░░░░    
                    </pre>
  <p style="max-width: 600px; margin: 0 auto 40px; color: #00ffcc; text-wrap: auto;">2. Pair up with someone in your gang. Attempt to blink at the same time. Do not talk. </p>
    `

  container.appendChild(pre);

  setTimeout(() => {
    pre.innerHTML = newHTML;
    const eyegraphic = document.getElementById('eyegraphic');
    eyegraphic.style.fontSize = '4px';
    
  }, 5000);

  setTimeout(() => {
    pre.style.opacity = '0';
    setTimeout(() => {
      pre.remove();
      showGlitchScreen();
    }, 2000);
  }, 90000);
}

function showGlitchScreen() {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '100vw';
  container.style.height = '100vh';
  container.style.backgroundColor = '#000';
  container.style.zIndex = '10000';
  container.style.display = 'flex';
  container.style.justifyContent = 'center';
  container.style.alignItems = 'center';
  container.style.overflow = 'hidden';

  const image = document.createElement('img');
  
  // Determine which image to show based on platform
  if (platform === 'iOS' || platform === 'Other') {
    image.src = 'img/iPhone.jpeg';
  } else if (platform === 'Android') {
    image.src = 'img/Android.jpeg';
  }
  
  image.style.maxWidth = '100%';
  image.style.maxHeight = '100%';
  image.style.objectFit = 'contain';
  
  container.appendChild(image);
  document.body.appendChild(container);
  
  // Remove the glitch screen after a few seconds
  setTimeout(() => {
    container.style.opacity = '0';
    container.remove();
    showPointingScreen();
  }, 2000);
}


function showPointingScreen() {
  const container = document.getElementById('gameContainer');
  let seconds = 15;
  container.innerHTML = `
    <h2 style="font-size: 1.8em;">Point to who you think is human.</h2>
    <p id="countdownDisplay" style="font-size: 1.8em;">${seconds}</p>
  `;

  const countdown = setInterval(() => {
    seconds--;
    document.getElementById('countdownDisplay').textContent = seconds;
    if (seconds <= 0) {
      clearInterval(countdown);
      showFinalReveal();
    }
  }, 1000);
}

function showFinalReveal() {
  const container = document.getElementById('gameContainer');
  const role = currentRole;
  
  if (isLastHuman) {
    // Last human display
    container.style.backgroundColor = '#000';
    container.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; height: 100vh;">
        <img src="/img/LHWinner.png" alt="Last Human Trophy" style="max-width: 80%; max-height: 80%;">
      </div>
    `;
  } else {
    // Normal display for non-last humans
    container.innerHTML = `
      <h2 style="font-size: 2em; margin-bottom: 20px;">REVEAL</h2>
      <p style="font-size: 1.5em;">You started as a <strong>${role}</strong>,</p>
      <p style="font-size: 1.5em;">but you are <span style="color: #ff3366; font-weight: bold;">synthetic</span>.</p>
    `;
  }
}

// P5.js setup and draw functions
let glitchShapes = [];

function setup() {
  // Create canvas that fits the window
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.style('z-index', '-1'); // Place canvas behind UI elements
  canvas.position(0, 0);         // Position at top-left corner
  frameRate(30);
  
  // Create glitch shapes
  for (let i = 0; i < 20; i++) {
    glitchShapes.push({
      x: random(width),
      y: random(height),
      d: random(10, 50),
      dx: random(-1, 1),
      dy: random(-1, 1),
      pulse: random(0.01, 0.05)
    });
  }
}

function draw() {
  background(10, 10, 10, 30);
  for (let i = 0; i < height; i += 40) {
    if (random() < 0.2) {
      stroke(255, 0, 255, random(10, 50));
      line(0, i + random(-2, 2), width, i + random(-2, 2));
    }
  }
  stroke(255, 255, 255, 15);
  for (let g of glitchShapes) {
    ellipse(g.x, g.y, g.d);
    g.x += g.dx;
    g.y += g.dy;
    g.d += sin(frameCount * g.pulse);
    if (g.x < 0 || g.x > width || g.y < 0 || g.y > height) {
      g.x = random(width);
      g.y = random(height);
    }
  }
  if (random() < 0.03) {
    let x = random(width);
    let y = random(height);
    stroke(0, 255, 0, 50);
    textSize(random(12, 20));
    text(String.fromCharCode(0x30A0 + floor(random(96))), x, y);
  }
  if (random() < 0.01) {
    for (let i = 0; i < 3; i++) {
      let x = floor(random(width));
      let y = floor(random(height));
      stroke(random(200, 255), 0, random(200, 255), 40);
      rect(x, y, random(10, 40), random(10, 40));
    }
  }
  if (frameCount % 240 === 0) {
    fill(255, 0, 0, 20);
    rect(0, 0, width, height);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

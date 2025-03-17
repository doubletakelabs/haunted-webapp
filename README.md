# Haunted House Webapp Prototype

A simple web application for a haunted house experience with synchronized audio playback.

## Features

- Alternating track assignment for visitors (track1.mp3 or track2.mp3)
- Admin panel to control audio playback for all connected clients
- Synchronized audio playback across all clients
- Late-joining clients will sync with the current playback time
- Special ending track that can be triggered for all clients simultaneously

## Setup

1. Install dependencies:
```
npm install
```

2. Add your audio files:
   - Place your audio files in the `public/audio` directory
   - Required files:
     - `track1.mp3` - First alternating track
     - `track2.mp3` - Second alternating track
     - `end.mp3` - Ending track that plays for all clients

3. Start the server:
```
node app.js
```

4. Access the application:
   - Main route: http://localhost:3000/
   - Admin panel: http://localhost:3000/admin

## How It Works

- Each visitor is automatically assigned either track1.mp3 or track2.mp3 in alternating order
- The admin panel can control playback for all connected clients
- When a new client connects, they will automatically sync with the current playback time
- The admin can trigger the ending track (end.mp3) to play for all clients simultaneously
- When the ending track plays, it stops any currently playing track

## Technical Details

- Built with Express.js and Socket.io
- Uses cookies to track user sessions and audio track assignment
- Real-time communication between clients and server
- Responsive design that works on mobile and desktop
- JavaScript code is organized in separate files for better maintainability 
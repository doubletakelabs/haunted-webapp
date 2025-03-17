# Haunted House Web Application

A web application for a haunted house experience that plays synchronized audio tracks for visitors.

## Features

- Alternating track assignments for visitors (Track 1 or Track 2)
- Persistent track assignment using cookies
- Loading progress bar for audio files
- Admin panel for controlling the experience
- Real-time user tracking in the admin panel
- Synchronized audio playback across all clients

## Setup

1. Install dependencies:
```
npm install
```

2. Make sure you have the following audio files in the `public/audio` directory:
   - `track1.mp3` - First audio track
   - `track2.mp3` - Second audio track
   - `end.mp3` - Ending audio track

## Running the Application

### Default Port (3000)

```
node app.js
```

### Custom Port

You can specify a custom port using the `--port` flag:

```
node app.js --port 3003
```

## Accessing the Application

- Client page: `http://localhost:<port>/`
- Admin panel: `http://localhost:<port>/admin`

## Admin Controls

The admin panel provides the following controls:

- **Restart Experience**: Resets the experience for all clients
- **Play All Audio**: Starts audio playback for all clients
- **Pause All Audio**: Pauses audio playback for all clients
- **Play Ending Track**: Plays the ending track for all clients

The admin panel also displays a list of connected users with their assigned tracks and connection times.

## Client Experience

1. When a client visits the page, they are assigned to either Track 1 or Track 2
2. The audio files are preloaded with a progress bar
3. Once loaded, the client sees a "Start Experience" button
4. After clicking the button, the client will hear their assigned audio track
5. The admin can control the audio playback for all clients

## Technical Notes

- The application uses Socket.IO for real-time communication
- Track assignments alternate between Track 1 and Track 2
- Track assignments are stored in cookies and persist until the experience ends
- The admin can see which users are connected and which tracks they're assigned to
- Audio playback is synchronized across all clients 
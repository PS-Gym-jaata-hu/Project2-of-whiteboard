const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const {Server} = require('socket.io');
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 5183;

// Store rooms and their users
const rooms = new Map(); // roomId -> { users: Set, canvasState: string }

// Helper function to generate room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Welcome to the Whiteboard Server!');
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Create a new room
    socket.on('create-room', (data) => {
        const { userName } = data;
        const roomId = generateRoomId();
        
        rooms.set(roomId, {
            users: new Set([socket.id]),
            canvasState: '',
            userNames: new Map([[socket.id, userName]])
        });
        
        socket.join(roomId);
        socket.emit('room-created', { roomId, userName });
        console.log(`Room ${roomId} created by ${userName} (${socket.id})`);
    });

    // Join an existing room
    socket.on('join-room', (data) => {
        const { roomId, userName } = data;
        
        if (!rooms.has(roomId)) {
            socket.emit('room-error', { message: 'Room does not exist' });
            return;
        }
        
        const room = rooms.get(roomId);
        room.users.add(socket.id);
        room.userNames.set(socket.id, userName);
        
        socket.join(roomId);
        
        // Get all user names in the room
        const allUsers = Array.from(room.userNames.values());
        
        socket.emit('room-joined', { 
            roomId, 
            userName,
            allUsers: allUsers,
            userCount: room.users.size
        });
        
        // Send current canvas state to new user
        if (room.canvasState) {
            socket.emit('canvas-state', room.canvasState);
        }
        
        // Notify other users in the room with updated user list
        const updatedUsers = Array.from(room.userNames.values());
        socket.to(roomId).emit('user-joined', { 
            userName, 
            userCount: room.users.size,
            allUsers: updatedUsers
        });
        console.log(`${userName} (${socket.id}) joined room ${roomId}. Total users: ${room.users.size}`);
    });

    // Handle drawing events
    socket.on('draw', (data) => {
        const { roomId, drawData } = data;
        if (rooms.has(roomId)) {
            // Broadcast to all other users in the room
            socket.to(roomId).emit('draw', drawData);
        }
    });

    // Handle canvas state updates (for clearing, loading, etc.)
    socket.on('canvas-state-update', (data) => {
        const { roomId, canvasState } = data;
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.canvasState = canvasState;
            // Broadcast to all users in the room including sender
            io.to(roomId).emit('canvas-state', canvasState);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove user from all rooms
        for (const [roomId, room] of rooms.entries()) {
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
                const userName = room.userNames.get(socket.id) || 'Unknown';
                room.userNames.delete(socket.id);
                
                // Get updated user list
                const updatedUsers = Array.from(room.userNames.values());
                
                // Notify other users
                socket.to(roomId).emit('user-left', { 
                    userName, 
                    userCount: room.users.size,
                    allUsers: updatedUsers
                });
                
                // Clean up empty rooms
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} deleted (empty)`);
                } else {
                    console.log(`${userName} left room ${roomId}`);
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
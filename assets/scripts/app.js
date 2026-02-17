import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    updateProfile, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    orderBy, 
    onSnapshot, 
    limit, 
    serverTimestamp, 
    setDoc, 
    getDoc,
    doc, 
    where, 
    getDocs, 
    deleteDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBaofEGy2yC_7cHz-h9A8hHjOdUrfa-86U",
  authDomain: "triochat-a7179.firebaseapp.com",
  projectId: "triochat-a7179",
  storageBucket: "triochat-a7179.firebasestorage.app",
  messagingSenderId: "297217689224",
  appId: "1:297217689224:web:5c1db8b5e9df9e4640c13d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- STATE ---
let currentUser = null;
let currentChannelId = null;
let unsubscribeMessages = null;
let unsubscribeChannels = null;
let unsubscribeRequests = null;
let unsubscribeWatchdog = null;

// --- DOM ELEMENTS ---
const loginScreen = document.getElementById('login-screen');
const authForm = document.getElementById('auth-form');
const messagesFeed = document.getElementById('messages-feed');
const channelList = document.getElementById('channel-list');
const dmList = document.getElementById('dm-list'); 
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const friendsModal = document.getElementById('friends-modal');
const settingsModal = document.getElementById('settings-modal');
const profileModal = document.getElementById('user-profile-modal');
const friendStatusMsg = document.getElementById('friend-status-msg');
const pendingList = document.getElementById('pending-list');
const pendingBadge = document.getElementById('pending-badge');
const groupModal = document.getElementById('create-channel-modal');
const inputArea = document.querySelector('.message-input-area');
if (inputArea && !document.getElementById('slowmode-timer')) {
    const timerDiv = document.createElement('div');
    timerDiv.id = 'slowmode-timer';
    inputArea.appendChild(timerDiv);
}

// --- AUTH LOGIC ---
const switchBtn = document.getElementById('switch-btn');
let isRegistering = false;

if(switchBtn){
    switchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        isRegistering = !isRegistering;
        const title = document.getElementById('auth-title');
        const btn = document.getElementById('auth-btn');
        const group = document.getElementById('username-group');
        
        if (isRegistering) {
            title.textContent = "Join TrioChat";
            btn.textContent = "Sign Up";
            switchBtn.textContent = "Log In";
            group.style.display = "block";
        } else {
            title.textContent = "TrioChat";
            btn.textContent = "Log In";
            switchBtn.textContent = "Create Account";
            group.style.display = "none";
        }
    });
}

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const username = document.getElementById('username-input').value.trim();
    const authError = document.getElementById('auth-error');
    authError.textContent = "";

    try {
        if (isRegistering) {
            if (!username) throw new Error("Username is required!");

            const validation = validateUsername(username);
            if (!validation.valid) throw new Error(validation.error);

            // 1. Create the user in Firebase Auth
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            
            // 2. Set the Profile
            await updateProfile(cred.user, {
                displayName: username,
                photoURL: `https://api.dicebear.com/7.x/identicon/svg?seed=${username}`
            });

            // --- THE NEW PART: Send Welcome Message ---
            try {
                // This sends the join message to the specific "welcome" channel
                await addDoc(collection(db, "channels", "welcome", "messages"), {
                    text: `✨ A new chatter has arrived! Welcome to TrioChat, ${username}! Make sure to read the rules by clicking the book icon!`,
                    uid: "system",
                    displayName: "TrioBot",
                    photoURL: "https://api.dicebear.com/9.x/rings/svg?seed=Liam",
                    createdAt: serverTimestamp()
                });
            } catch (welcomeErr) {
                console.error("Welcome message failed:", welcomeErr);
                // We don't throw here so the user can still log in even if message fails
            }
            // ------------------------------------------

            window.location.reload();
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
    } catch (err) {
        let cleanMessage = err.message.replace("Firebase: ", "").replace("Error (auth/", "").replace(")", "").replace(/-/g, " ");
        authError.textContent = cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1);
    }
});

// --- PROFANITY FILTER STATE ---
let bannedWords = []; 

async function loadProfanityList() {
    try {
        console.log("Fetching profanity list...");
        
        // SWITCHING SOURCE: This is a simple flat array ["word1", "word2"]
        // It is much easier to process than the previous library.
        const response = await fetch('https://raw.githubusercontent.com/Voxelra/badword-filter/refs/heads/main/badwords.json');
        
        if (!response.ok) throw new Error("Network response was not ok");
        
        // This data is ALREADY an array. We don't need Object.keys()
        const data = await response.json();
        
        // Normalize to lowercase just in case
        const lowerCasedWords = data.map(w => w.toLowerCase());
        
        // Combine with manual list
        bannedWords = [...new Set([...bannedWords, ...lowerCasedWords])];
        
        console.log(`Profanity filter active: ${bannedWords.length} words loaded.`);
    } catch (err) {
        console.error("Failed to load profanity list, using fallback:", err);
    }
}

// Call this immediately
loadProfanityList();

// --- OPEN SETTINGS LOGIC ---
document.getElementById('user-settings-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentUser) {
        // 1. Show the modal
        const modal = document.getElementById('settings-modal');
        modal.classList.remove('hidden');

        // 2. Reset to the first tab (Account)
        document.querySelectorAll('.settings-nav-item').forEach(btn => btn.classList.remove('active'));
        document.querySelector('[data-tab="account"]').classList.add('active');
        document.querySelectorAll('.settings-section').forEach(sec => sec.classList.add('hidden'));
        document.getElementById('settings-tab-account').classList.remove('hidden');

        // 3. Populate current data
        document.getElementById('settings-username-input').value = currentUser.displayName || "";
        document.getElementById('preview-display-name').textContent = currentUser.displayName || "Username";
        document.getElementById('settings-avatar-img').src = currentUser.photoURL || `https://api.dicebear.com/7.x/identicon/svg?seed=${currentUser.displayName}`;
        
        // Clear old inputs
        document.getElementById('settings-url-input').value = "";
        document.getElementById('settings-avatar-input').value = "";
    }
});

// 1. Tab Switching Logic
document.querySelectorAll('.settings-nav-item[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');
        
        // Toggle Active Button
        document.querySelectorAll('.settings-nav-item').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // Toggle Visible Section
        document.querySelectorAll('.settings-section').forEach(section => section.classList.add('hidden'));
        document.getElementById(`settings-tab-${targetTab}`).classList.remove('hidden');
    });
});

// 2. Real-Time Preview Logic
const settingsUsernameInput = document.getElementById('settings-username-input');
const settingsUrlInput = document.getElementById('settings-url-input');
const settingsAvatarInput = document.getElementById('settings-avatar-input');
const settingsAvatarImg = document.getElementById('settings-avatar-img');
const previewName = document.getElementById('preview-display-name');

settingsUsernameInput.addEventListener('input', (e) => {
    previewName.textContent = e.target.value || currentUser.displayName;
});

settingsUrlInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url) {
        settingsAvatarImg.src = url;
        settingsAvatarInput.value = ""; // Clear other option
    }
});

settingsAvatarInput.addEventListener('input', (e) => {
    const seed = e.target.value.trim();
    if (seed) {
        settingsAvatarImg.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`;
        settingsUrlInput.value = ""; // Clear other option
    }
});

// 3. Close Button
document.getElementById('close-settings-btn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

// 4. Logout (Alternate Button in Sidebar)
const logoutAlt = document.getElementById('logout-btn-alt');
if (logoutAlt) {
    logoutAlt.addEventListener('click', () => {
        signOut(auth).then(() => window.location.reload());
        unsubscribe();
    });
}

// 5. Save Logic (Integration with your existing validation)
document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const newName = settingsUsernameInput.value.trim();
    const finalAvatarUrl = settingsAvatarImg.src;

    if (!newName) return alert("Username is required!");

    try {
        // Validation & Duplication Check (Keep your existing logic here)
        const validation = validateUsername(newName);
        if (!validation.valid) return alert(validation.error);

        // Update Firebase
        await updateProfile(auth.currentUser, { 
            displayName: newName, 
            photoURL: finalAvatarUrl 
        });
        
        await updateDoc(doc(db, "users", currentUser.uid), { 
            username: newName, 
            photoURL: finalAvatarUrl 
        });

        alert("Profile updated successfully!");
        settingsModal.classList.add('hidden');
        window.location.reload(); // Refresh to propagate changes
    } catch (err) {
        console.error(err);
        alert("Failed to save settings.");
    }
});

// --- AUTH STATE OBSERVER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Initial UI Setup
        currentUser = user;
        loginScreen.classList.add('hidden');
        const usernameDisplay = document.getElementById('username-display');
        if (usernameDisplay) usernameDisplay.textContent = user.displayName;

        // 2. Notification Permissions
        if ("Notification" in window && Notification.permission !== "granted") {
            Notification.requestPermission();
        }

        // 3. Security Check: Initial Ban Check
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists() && userSnap.data().isBanned) {
            alert("🚨 Your account has been permanently banned for violating community guidelines.");
            signOut(auth);
            return; // Kill the execution here
        }

        // 4. Real-time Watcher: Warnings & Live Banning
        onSnapshot(userRef, (docSnap) => {
            const userData = docSnap.data();
            if (!userData) return;

            // Live Warning Logic
            if (userData.warnings && userData.warnings.length > 0) {
                const latestWarning = userData.warnings[userData.warnings.length - 1];
                const lastSeenWarn = localStorage.getItem('last_warn_date');
                const warnDate = latestWarning.date.toDate().toISOString();

                if (lastSeenWarn !== warnDate) {
                    alert(`⚠️ OFFICIAL WARNING:\n\nReason: ${latestWarning.reason}\nIssued by: ${latestWarning.by}`);
                    localStorage.setItem('last_warn_date', warnDate);
                }
            }

            // Live Ban Logic (Kicks them if an admin bans them while online)
            if (userData.isBanned) {
                alert("🚨 Your account has been permanently banned.");
                signOut(auth).then(() => window.location.reload());
            }
        });

        // 5. App Initialization
        // We run these only after the security checks pass
        await syncUserToDB(user); 
        startPresenceSystem(user);
        startGlobalWatchers();
        loadChannels();
        listenForFriendRequests(); 

    } else {
        // User is logged out
        loginScreen.classList.remove('hidden');
    }
});

// --- GLOBAL ANNOUNCEMENT WATCHER ---
function startGlobalWatchers() {
    // Listen to the announcements channel specifically
    const announcementQuery = query(
        collection(db, "channels", "announcements", "messages"), 
        orderBy("createdAt", "desc"), 
        limit(1)
    );

    let initialAnnouncementLoad = true;

    onSnapshot(announcementQuery, (snapshot) => {
        if (initialAnnouncementLoad) {
            initialAnnouncementLoad = false;
            return;
        }

        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                // Only notify if we aren't currently looking at the announcements channel
                if (currentChannelId !== 'announcements' && msg.uid !== currentUser.uid) {
                    sendNotification("📢 New Announcement", msg.text, 'announcements');
                }
            }
        });
    });
}

async function syncUserToDB(user) {
    const userRef = doc(db, "users", user.uid);
    
    // THE FIX: Use getDoc (singular) and check .exists()
    const userSnap = await getDoc(userRef);

    let existingStatus = 'online'; 
    let joinedDate = serverTimestamp();

    if (userSnap.exists()) {
        const existingData = userSnap.data();
        existingStatus = existingData.customStatus || 'online';
        joinedDate = existingData.joinedAt || joinedDate;
    }

    const userData = {
        username: user.displayName,
        email: user.email,
        uid: user.uid,
        photoURL: user.photoURL,
        lastSeen: serverTimestamp(),
        customStatus: existingStatus, 
        joinedAt: joinedDate
    };

    // Use merge: true so we don't accidentally delete fields like 'role'
    await setDoc(userRef, userData, { merge: true });
    
    // Update local UI dot
    const statusDot = document.getElementById('current-status-dot');
    if (statusDot) statusDot.className = `user-status-dot dot-${existingStatus}`;
}

// --- FRIEND SYSTEM ---
document.getElementById('add-dm-btn').addEventListener('click', () => {
    friendsModal.classList.remove('hidden');
    document.getElementById('tab-add-friend').click();
});
document.getElementById('close-friends-btn').addEventListener('click', () => friendsModal.classList.add('hidden'));

document.getElementById('tab-add-friend').addEventListener('click', (e) => {
    e.target.classList.add('active');
    document.getElementById('tab-pending').classList.remove('active');
    document.getElementById('view-add-friend').classList.remove('hidden');
    document.getElementById('view-pending').classList.add('hidden');
});

document.getElementById('tab-pending').addEventListener('click', (e) => {
    e.target.classList.add('active');
    document.getElementById('tab-add-friend').classList.remove('active');
    document.getElementById('view-pending').classList.remove('hidden');
    document.getElementById('view-add-friend').classList.add('hidden');
});

document.getElementById('send-request-btn').addEventListener('click', async () => {
    const targetUsername = document.getElementById('friend-username-input').value.trim();
    friendStatusMsg.textContent = "Searching...";
    if (!targetUsername || targetUsername === currentUser.displayName) return;

    try {
        const q = query(collection(db, "users"), where("username", "==", targetUsername));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            friendStatusMsg.textContent = "User not found.";
            friendStatusMsg.style.color = "#f04747";
            return;
        }

        const targetUser = snapshot.docs[0].data();
        const checkQ = query(collection(db, "friend_requests"), where("fromUid", "==", currentUser.uid), where("toUid", "==", targetUser.uid));
        const checkSnap = await getDocs(checkQ);

        if (!checkSnap.empty) {
            friendStatusMsg.textContent = "Request already sent!";
            return;
        }

        await addDoc(collection(db, "friend_requests"), {
            fromUid: currentUser.uid,
            fromName: currentUser.displayName,
            toUid: targetUser.uid,
            toName: targetUser.username,
            status: "pending",
            createdAt: serverTimestamp()
        });

        friendStatusMsg.textContent = `Sent to ${targetUser.username}!`;
        friendStatusMsg.style.color = "#3ba55c";
    } catch (err) { console.error(err); }
});

document.getElementById('close-profile-btn').addEventListener('click', () => profileModal.classList.add('hidden'));

document.addEventListener('DOMContentLoaded', () => {
    const rulesModal = document.getElementById('rules-modal');
    const viewRulesBtn = document.getElementById('view-rules-btn');
    const closeRulesBtn = document.getElementById('close-rules-btn');

    if (viewRulesBtn && rulesModal) {
        viewRulesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("Rules button clicked!"); // Check F12 console for this!
            rulesModal.classList.remove('hidden');
        });
    }

    if (closeRulesBtn) {
        closeRulesBtn.addEventListener('click', () => {
            rulesModal.classList.add('hidden');
        });
    }
});

function listenForFriendRequests() {
    const q = query(collection(db, "friend_requests"), where("toUid", "==", currentUser.uid), where("status", "==", "pending"));
    unsubscribeRequests = onSnapshot(q, (snapshot) => {
        pendingList.innerHTML = '';
        if (snapshot.size > 0) {
            pendingBadge.textContent = snapshot.size;
            pendingBadge.classList.remove('hidden');
        } else {
            pendingBadge.classList.add('hidden');
            pendingList.innerHTML = '<p style="color: #72767d; margin-top: 20px;">No pending requests.</p>';
        }

        snapshot.forEach((reqDoc) => {
            const req = reqDoc.data();
            const div = document.createElement('div');
            div.classList.add('pending-item');
            div.innerHTML = `
                <div class="pending-info"><strong>${req.fromName}</strong><span>Incoming Request</span></div>
                <div class="pending-actions">
                    <button class="btn-accept">✓</button>
                    <button class="btn-reject">✕</button>
                </div>`;
            div.querySelector('.btn-accept').addEventListener('click', async () => {
                await addDoc(collection(db, "channels"), { type: 'private', members: [currentUser.uid, req.fromUid], membersNames: [currentUser.displayName, req.fromName], createdAt: serverTimestamp() });
                await deleteDoc(doc(db, "friend_requests", reqDoc.id));
            });
            div.querySelector('.btn-reject').addEventListener('click', async () => { await deleteDoc(doc(db, "friend_requests", reqDoc.id)); });
            pendingList.appendChild(div);
        });
    });
}

// --- CHANNEL LOADING LOGIC ---
function loadChannels() {
    const q = query(collection(db, "channels"), orderBy("createdAt", "asc"));
    
    unsubscribeChannels = onSnapshot(q, (snapshot) => {
        channelList.innerHTML = ''; 
        dmList.innerHTML = '';
        
        let firstId = null; 
        let firstName = null;

        // --- THE SORTING FIX ---
        // Convert the snapshot to an array so we can re-sort it manually
        const allChannels = [];
        snapshot.forEach(doc => allChannels.push({ id: doc.id, ...doc.data() }));

        // Sort: Welcome always comes first, then everything else by createdAt
        allChannels.sort((a, b) => {
            const order = { 'welcome': 1, 'announcements': 2 };
            const aOrder = order[a.id] || 99;
            const bOrder = order[b.id] || 99;
            
            return aOrder - bOrder; // Sorts 1, then 2, then everything else
        });

        // Now render the sorted list
        allChannels.forEach((data) => { 
            const isDM = data.type === 'private';
            const isGroup = data.type === 'private-group';
            
            if ((isDM || isGroup) && !data.members.includes(currentUser.uid)) return;

            const div = document.createElement('div');
            div.classList.add('channel');

            if (isDM) {
                const friendName = data.membersNames.find(name => name !== currentUser.displayName) || "Unknown";
                div.classList.add('dm-item');
                div.innerHTML = `<div style="display:flex; align-items:center; gap: 10px;"><span style="opacity:0.6;">@</span> <span>${friendName}</span></div><button class="unfriend-btn">✕</button>`;
                
                div.querySelector('.unfriend-btn').addEventListener('click', async (e) => {
                    e.stopPropagation(); 
                    if(confirm(`Remove ${friendName}?`)) {
                        await deleteDoc(doc(db, "channels", data.id));
                        if(currentChannelId === data.id) exitChat();
                    }
                });
                dmList.appendChild(div);
            } else {
                // Style for public channels/groups
                const prefix = isGroup ? '' : '';
                const color = isGroup ? '#faa61a' : 'rgba(255,255,255,0.6)';
                
                div.innerHTML = `<span style="color:${color}; font-weight:bold; margin-right:8px;">${data.name}</span>`;
                channelList.appendChild(div);
            }

            div.addEventListener('click', () => {
                document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                let displayTitle = isDM ? data.membersNames.find(name => name !== currentUser.displayName) : data.name;
                selectChannel(data.id, displayTitle, isDM);
            });

            // Set the first channel (Welcome) as the default selected chat
            if (!firstId && !isDM) { 
                firstId = data.id; 
                firstName = data.name; 
            }
        });

        if (firstId && !currentChannelId) {
            selectChannel(firstId, firstName, false);
            if(channelList.firstChild) channelList.firstChild.classList.add('active');
        }
    });
}

async function selectChannel(id, name, isPrivate) {
    currentChannelId = id;
    const channelNameDisplay = document.getElementById('current-channel-name');
    const channelDescDisplay = document.getElementById('channel-desc');
    const inputArea = document.querySelector('.message-input-area');
    const messageInput = document.getElementById('message-input'); // Select the input

    // Update the header name
    channelNameDisplay.textContent = isPrivate ? `@ ${name}` : `# ${name}`;

    // --- THE FIX: Update the Placeholder ---
    if (messageInput) {
        messageInput.placeholder = isPrivate ? `Message @${name}` : `Message #${name}`;
    }

    // Tells the CSS which channel we are in for styling
    messagesFeed.setAttribute('data-channel', id);

    try {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data() || {};
        const isAdmin = userData.role === 'staff' || userData.role === 'dev';

        if (id === 'welcome') {
            channelDescDisplay.textContent = "Arrival announcements only.";
            if (inputArea) inputArea.style.display = 'none'; 
        } 
        else if (id === 'announcements') {
            channelDescDisplay.textContent = "Official news and updates.";
            if (inputArea) inputArea.style.display = isAdmin ? 'flex' : 'none';
        } 
        else {
            channelDescDisplay.textContent = isPrivate ? "Private Conversation" : "Global Chat";
            if (inputArea) inputArea.style.display = 'flex';
        }
    } catch (err) {
        console.error("Error checking permissions:", err);
    }

    loadMessages(id);
}

function exitChat() {
    currentChannelId = null;
    if (unsubscribeMessages) unsubscribeMessages();
    if (unsubscribeWatchdog) unsubscribeWatchdog();
    messagesFeed.innerHTML = ''; 
    document.getElementById('current-channel-name').textContent = "TrioChat";
    document.getElementById('channel-desc').textContent = "Select a channel";
}

// --- GROUP CREATION & MODAL FIXES ---
document.getElementById('add-channel-btn').addEventListener('click', async () => {
    const list = document.getElementById('friend-selector-list');
    groupModal.classList.remove('hidden');
    list.innerHTML = 'Loading friends...';

    const q = query(collection(db, "channels"), where("type", "==", "private"), where("members", "array-contains", currentUser.uid));
    const snapshot = await getDocs(q);
    
    list.innerHTML = '';
    if (snapshot.empty) {
        list.innerHTML = '<p style="padding:10px; color: #b9bbbe;">Add friends via DMs first!</p>';
        return;
    }

    snapshot.forEach((doc) => {
        const data = doc.data();
        const fIdx = data.members.indexOf(currentUser.uid) === 0 ? 1 : 0;
        const div = document.createElement('div');
        div.classList.add('friend-select-item');
        div.innerHTML = `<input type="checkbox" value="${data.members[fIdx]}" data-name="${data.membersNames[fIdx]}"><span>${data.membersNames[fIdx]}</span>`;
        list.appendChild(div);
    });
});

document.getElementById('create-channel-submit').addEventListener('click', async () => {
    const groupName = document.getElementById('new-group-name').value.trim();
    const boxes = document.querySelectorAll('.friend-select-item input:checked');
    if (!groupName || boxes.length === 0) return alert("Enter name and select friends!");

    const members = [currentUser.uid]; const names = [currentUser.displayName];
    boxes.forEach(b => { members.push(b.value); names.push(b.getAttribute('data-name')); });

    await addDoc(collection(db, "channels"), { name: groupName, type: 'private-group', members, membersNames: names, createdAt: serverTimestamp(), createdBy: currentUser.uid });
    groupModal.classList.add('hidden');
    document.getElementById('new-group-name').value = '';
});

// Fix Cancel Button
document.getElementById('cancel-channel-btn').addEventListener('click', () => {
    groupModal.classList.add('hidden');
    document.getElementById('new-group-name').value = '';
});

// --- MESSAGING ---
// --- MESSAGING ---
const CHAR_LIMIT = 2000;
const SLOWMODE_COOLDOWN = 3000; // 3 Seconds
let lastMessageTime = 0;
let slowmodeInterval = null;

messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    const now = Date.now();

    // 1. Check Content Existence
    if (!text) return;

    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (userSnap.data().isMuted) {
        alert("You are currently muted and cannot send messages.");
        return;
    }

    // 2. Check Character Limit
    if (text.length > CHAR_LIMIT) {
        alert(`Message is too long! (${text.length}/${CHAR_LIMIT})`);
        return;
    }

    // 3. PROFANITY FILTER
    // Convert message to lowercase for comparison
    const lowerText = text.toLowerCase();
    let containsBadWord = false;

    for (const word of bannedWords) {
        // Ensure the banned word is also lowercase before checking
        // This prevents case mismatches
        if (lowerText.includes(word.toLowerCase())) {
            console.log("Blocked word:", word); // Debugging: See what triggered it
            containsBadWord = true;
            break;
        }
    }

    if (containsBadWord) {
        alert("Your message contains restricted words and cannot be sent.");
        
        // Visual Feedback (Red Flash)
        const input = document.getElementById('message-input');
        input.style.borderColor = '#ed4245';
        setTimeout(() => input.style.borderColor = 'rgba(255,255,255,0.05)', 500);
        return; // Stop execution here
    }

    // 4. CHECK SLOWMODE
    const timeSinceLast = now - lastMessageTime;
    if (timeSinceLast < SLOWMODE_COOLDOWN) {
        const input = document.getElementById('message-input');
        input.style.borderColor = '#ed4245';
        setTimeout(() => input.style.borderColor = 'rgba(255,255,255,0.05)', 500);
        return; 
    }

    // 5. Send Message
    if (currentChannelId) {
        try {
            await addDoc(collection(db, "channels", currentChannelId, "messages"), { 
                text, 
                uid: currentUser.uid, 
                displayName: currentUser.displayName, 
                photoURL: currentUser.photoURL, 
                createdAt: serverTimestamp() 
            });
            
            messageInput.value = '';
            
            // Activate Slowmode Timer
            lastMessageTime = Date.now();
            triggerSlowmodeUI();

        } catch (err) {
            console.error("Error sending message:", err);
        }
    }
});

function triggerSlowmodeUI() {
    const timerEl = document.getElementById('slowmode-timer');
    const input = document.getElementById('message-input');
    
    if (!timerEl) return;

    // Reset previous intervals if they exist
    if (slowmodeInterval) clearInterval(slowmodeInterval);

    let timeLeft = SLOWMODE_COOLDOWN / 1000;
    
    // Show initial state
    timerEl.textContent = `Slowmode is enabled: ${timeLeft.toFixed(1)}s`;
    timerEl.classList.add('active');
    
    // Disable input visual style (optional, usually Discord keeps it editable but you can't submit)
    input.placeholder = `Slowmode enabled...`;

    slowmodeInterval = setInterval(() => {
        const elapsed = Date.now() - lastMessageTime;
        const remaining = Math.max(0, SLOWMODE_COOLDOWN - elapsed);
        
        if (remaining <= 0) {
            // Cooldown finished
            clearInterval(slowmodeInterval);
            timerEl.classList.remove('active');
            input.placeholder = `Message...`;
        } else {
            // Update text
            timerEl.textContent = `Slowmode is enabled: ${(remaining / 1000).toFixed(1)}s`;
        }
    }, 100);
}

messageInput.addEventListener('input', () => {
    const remaining = CHAR_LIMIT - messageInput.value.length;
    if (remaining < 100) {
        messageInput.style.borderColor = '#ed4245'; // Turn red near limit
    } else {
        messageInput.style.borderColor = 'rgba(255,255,255,0.05)'; // Reset
    }
});

function loadMessages(channelId) {
    if (unsubscribeMessages) unsubscribeMessages();
    if (unsubscribeWatchdog) unsubscribeWatchdog();

    messagesFeed.innerHTML = '';
    messagesFeed.setAttribute('data-channel', channelId);

    const q = query(collection(db, "channels", channelId, "messages"), orderBy("createdAt", "asc"), limit(100));
    let isInitialLoad = true; 

    unsubscribeMessages = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const msgData = change.doc.data();
            const msgId = `msg-${change.doc.id}`;
            
            if (change.type === "added") {
                renderMessage(msgData, change.doc.id);

                // --- MOVE NOTIFICATION LOGIC HERE ---
                if (!isInitialLoad && msgData.uid !== currentUser.uid) {
                    const isDM = document.getElementById('channel-desc').textContent.includes("Private");
                    const isMention = msgData.text.toLowerCase().includes(`@${currentUser.displayName.toLowerCase()}`);

                    if (isDM) {
                        sendNotification(`DM from ${msgData.displayName}`, msgData.text, channelId);
                    } else if (isMention) {
                        sendNotification(`Ping from ${msgData.displayName}`, msgData.text, channelId);
                    }
                }
            } 
            else if (change.type === "modified") {
                const existingMsg = document.getElementById(msgId);
                if (existingMsg && msgData.createdAt) {
                    const timeSpan = existingMsg.querySelector('.timestamp');
                    if (timeSpan) timeSpan.textContent = formatTime(msgData.createdAt);
                }
            }
        });

        isInitialLoad = false;
        messagesFeed.scrollTop = messagesFeed.scrollHeight;
    });
}

// --- PRESENCE & MEMBERS ---
function startPresenceSystem(user) {
    let lastActivity = Date.now();
    const trackActivity = () => { lastActivity = Date.now(); };
    window.addEventListener('mousemove', trackActivity);
    window.addEventListener('keydown', trackActivity);

    const worker = new Worker('assets/scripts/presence-worker.js');
    worker.onmessage = function(e) {
        if (e.data === 'ping') {
            // Only update Firebase if they aren't AFK
            if (Date.now() - lastActivity < 120000) {
                updateMyStatus(user);
            }
        }
    };
    loadMembers(); 
}

async function updateMyStatus(user) {
    try {
        // Use updateDoc to avoid overwriting customStatus
        await updateDoc(doc(db, "users", user.uid), { 
            lastSeen: serverTimestamp() 
        });
    } catch (err) {
        // If doc doesn't exist, syncUserToDB handles it
    }
}

async function loadMembers() {
    const list = document.getElementById('members-list');
    const countSpan = document.getElementById('online-count');
    
    // We move the friend list into a real-time listener
    const friendQuery = query(
        collection(db, "channels"), 
        where("type", "==", "private"), 
        where("members", "array-contains", currentUser.uid)
    );

    // Keep track of friend IDs in a persistent set
    let friendUids = new Set();

    // 1. LISTEN FOR FRIENDS (DMs)
    onSnapshot(friendQuery, (friendSnapshot) => {
        friendUids.clear();
        friendSnapshot.forEach(doc => {
            const members = doc.data().members;
            const friendUid = members.find(id => id !== currentUser.uid);
            if (friendUid) friendUids.add(friendUid);
        });

        // Whenever friends change, we need to force the member list to re-check the icons
        updateMemberListUI(); 
    });

    // 2. LISTEN FOR USERS
    const q = query(collection(db, "users"), orderBy("username", "asc"));
    let lastUserSnapshot = null;

    onSnapshot(q, (snapshot) => {
        lastUserSnapshot = snapshot;
        updateMemberListUI();
    });

    // 3. THE UI RENDERER
    function updateMemberListUI() {
        if (!lastUserSnapshot) return;
        
        let onlineCount = 0;
        const now = new Date();
        const onlineUsers = [];
        const offlineUsers = [];

        lastUserSnapshot.forEach((docSnap) => {
            const user = docSnap.data();
            let isOnline = false;
            let displayStatus = 'offline';

            // Status Logic
            if (currentUser && user.uid === currentUser.uid) {
                isOnline = true;
                displayStatus = user.customStatus || 'online';
            } else if (user.lastSeen) {
                const lastSeenDate = user.lastSeen.toDate();
                if ((now - lastSeenDate) / 1000 < 35) { 
                    isOnline = true;
                    displayStatus = user.customStatus || 'online';
                }
            }

            if (displayStatus === 'invisible') { isOnline = false; displayStatus = 'offline'; }

            // Check friendship status from our real-time Set
            const userObj = { ...user, isOnline, displayStatus, isFriend: friendUids.has(user.uid) };
            
            if (isOnline) { onlineUsers.push(userObj); onlineCount++; } 
            else { offlineUsers.push(userObj); }
        });

        const sortedList = [...onlineUsers, ...offlineUsers];
        countSpan.textContent = onlineCount;

        const seenIds = new Set();
        sortedList.forEach((user, index) => {
            seenIds.add(user.uid);
            const itemId = `member-${user.uid}`;
            let el = document.getElementById(itemId);

            if (!el) {
                el = document.createElement('div');
                el.id = itemId;
                el.className = 'member-item';
                el.innerHTML = `
                    <div class="member-avatar-wrapper">
                        <img class="member-avatar">
                        <div class="status-indicator"></div>
                    </div>
                    <div class="member-name">
                        <span class="name-text"></span>
                        <span class="friend-badge"></span>
                    </div>
                `;
                el.onclick = () => showUserProfile(el.userData, el.userOnline);
            }

            el.userData = user;
            el.userOnline = user.isOnline;

            // Name
            el.querySelector('.name-text').textContent = user.username;
            
            // --- REAL-TIME ICON UPDATE ---
            const badge = el.querySelector('.friend-badge');
            if (user.isFriend) {
                badge.innerHTML = `
                    <div class="friend-icon" title="Friend" style="color: #caf7a5; display: flex;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                            <path d="M17.5 12.5l-.8-.8c-1-1-2.5-1-3.4 0l-.3.3-.3-.3c-.9-1-2.4-1-3.4 0l-.8.8c-1 1-1 2.5 0 3.4l4.5 4.5 4.5-4.5c1-1 1-2.4 0-3.4z" fill="#caf7a5"/>
                        </svg>
                    </div>`;
            } else {
                badge.innerHTML = '';
            }

            // Avatar & Status
            const img = el.querySelector('.member-avatar');
            img.src = user.photoURL || `https://api.dicebear.com/7.x/identicon/svg?seed=${user.username}`;
            el.querySelector('.status-indicator').className = `status-indicator dot-${user.displayStatus}`;

            const currentElAtIndex = list.children[index];
            if (currentElAtIndex !== el) list.insertBefore(el, currentElAtIndex);
        });

        // Cleanup removed users
        Array.from(list.children).forEach(child => {
            if (child.id.startsWith('member-') && !seenIds.has(child.id.replace('member-', ''))) child.remove();
        });
    }
}

async function showUserProfile(userData, isOnline) {
    const modal = document.getElementById('user-profile-modal');
    const badgeContainer = document.getElementById('profile-modal-badges');
    const profileActions = modal.querySelector('.profile-actions');
    
    if (badgeContainer) badgeContainer.innerHTML = '';

    // Standard Badge Logic
    if (userData.role === 'staff') {
        badgeContainer.innerHTML += `<div class="badge-pill badge-admin" title="Staff"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.47 4.34-2.85 8.14-7 9.5V12H5V6.3l7-3.11v8.8z"/></svg></div>`;
    }
    if (userData.role === 'dev') { 
        badgeContainer.innerHTML += `<div class="badge-pill badge-developer" title="Developer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg></div>`;
    }
    if (userData.role === 'bug-tester') {
    badgeContainer.innerHTML += `
        <div class="badge-pill badge-tester" title="Bug Tester">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18M6 6l12 12"></path>
                <circle cx="12" cy="12" r="10"></circle>
            </svg>
        </div>`;
    }

    // Basic Info
    document.getElementById('profile-modal-avatar').src = userData.photoURL;
    document.getElementById('profile-modal-name').textContent = userData.username;
    document.getElementById('profile-modal-id').textContent = userData.uid;
    
    const joinedEl = document.getElementById('profile-modal-joined');
    joinedEl.textContent = userData.joinedAt ? userData.joinedAt.toDate().toLocaleDateString() : "2/16/2026";

    // Status Logic
    const statusEl = document.getElementById('profile-modal-status');
    let statusText = isOnline ? "Online" : "Offline";
    let statusColor = isOnline ? "#3ba55c" : "#747f8d";

    if (isOnline && userData.customStatus) {
        switch(userData.customStatus) {
            case 'idle': statusText = "Idle"; statusColor = "#faa61a"; break;
            case 'dnd': statusText = "Do Not Disturb"; statusColor = "#ed4245"; break;
            case 'invisible': statusText = "Offline"; statusColor = "#747f8d"; break;
        }
    }
    statusEl.textContent = statusText;
    statusEl.style.color = statusColor;

    // --- ADMIN CONTROLS SECTION ---
    // Remove existing admin box if it exists to prevent duplicates
    const oldAdminBox = modal.querySelector('.admin-controls-box');
    if (oldAdminBox) oldAdminBox.remove();

    // Check if YOU are Staff/Dev and the profile is NOT yours
    const myDoc = await getDoc(doc(db, "users", currentUser.uid));
    const myRole = myDoc.data()?.role;
    const isAdmin = myRole === 'staff' || myRole === 'dev';

    if (isAdmin && userData.uid !== currentUser.uid) {
        const adminDiv = document.createElement('div');
        adminDiv.className = 'admin-controls-box';
        adminDiv.innerHTML = `
            <label style="display:block; margin-bottom:10px; color:#ed4245; font-size:11px; font-weight:bold;">ADMINISTRATIVE TOOLS</label>
            <div class="admin-btns" style="display:flex; gap:10px;">
                <button id="admin-warn-btn" class="btn-warn">Warn</button>
                <button id="admin-mute-btn" class="btn-mute">${userData.isMuted ? 'Unmute' : 'Mute'}</button>
                <button id="admin-ban-btn" class="btn-ban">Ban</button>
            </div>
        `;
        profileActions.insertBefore(adminDiv, profileActions.firstChild);

        // Attach Events
        adminDiv.querySelector('#admin-warn-btn').onclick = () => adminAction('warn', userData.uid);
        adminDiv.querySelector('#admin-mute-btn').onclick = () => adminAction('mute', userData.uid);
        adminDiv.querySelector('#admin-ban-btn').onclick = () => adminAction('ban', userData.uid);
    }

    // Message Button Logic
    const msgBtn = document.getElementById('profile-message-btn');
    if (userData.uid === currentUser.uid) { 
        msgBtn.style.display = 'none'; 
    } else {
        msgBtn.style.display = 'block';
        msgBtn.onclick = () => { 
            modal.classList.add('hidden'); 
            openPrivateChat(userData); 
        };
    }

    modal.classList.remove('hidden');
}

async function openPrivateChat(userData) {
    const q = query(collection(db, "channels"), where("type", "==", "private"), where("members", "array-contains", currentUser.uid));
    const snap = await getDocs(q);
    let existing = null;
    snap.forEach(d => { if (d.data().members.includes(userData.uid)) existing = { id: d.id, name: userData.username }; });

    if (existing) selectChannel(existing.id, existing.name, true);
    else alert("You must be friends first!");
}

const statusDot = document.getElementById('current-status-dot');
const statusMenu = document.getElementById('status-picker-menu');

statusDot.addEventListener('click', (e) => {
    e.stopPropagation();
    statusMenu.classList.toggle('hidden');
});

document.querySelectorAll('.status-option').forEach(option => {
    option.addEventListener('click', async () => {
        const newStatus = option.getAttribute('data-status');
        
        statusDot.className = `user-status-dot dot-${newStatus}`;
        statusMenu.classList.add('hidden');

        if (currentUser) {
            const userRef = doc(db, "users", currentUser.uid);
            await updateDoc(userRef, { customStatus: newStatus });
        }
    });
});

// Global Modal Closer
window.addEventListener('click', (e) => {
    statusMenu.classList.add('hidden');
    if (e.target.classList.contains('modal')) {
        e.target.classList.add('hidden');
        if(document.getElementById('new-group-name')) document.getElementById('new-group-name').value = '';
    }
});

function formatTime(createdAt) {
    if (!createdAt || !createdAt.seconds) return "..."; // Show while waiting for server
    
    return new Date(createdAt.seconds * 1000).toLocaleTimeString([], {
        hour: '2-digit', 
        minute: '2-digit'
    });
}

function renderMessage(msg, docId) {
    if (document.getElementById(`msg-${docId}`)) return;

    const div = document.createElement('div');
    div.classList.add('message');
    div.id = `msg-${docId}`;
    
    // If the message is from the System, add a special attribute for CSS
    if (msg.uid === 'system') {
        div.setAttribute('data-system', 'true');
    }

    const time = formatTime(msg.createdAt);
    const fallbackAvatar = `https://api.dicebear.com/7.x/identicon/svg?seed=${msg.displayName}`;

    div.innerHTML = `
        <img src="${msg.photoURL || fallbackAvatar}" class="avatar">
        <div class="message-content">
            <h4>${msg.displayName} <span class="timestamp">${time}</span></h4>
            <p>${msg.text}</p>
        </div>
    `;
    messagesFeed.appendChild(div);
}

// --- USERNAME VALIDATION HELPER ---
function validateUsername(username) {
    // 1. Character Limit Check
    if (username.length > 16) {
        return { valid: false, error: "Username cannot exceed 16 characters." };
    }
    
    // 2. Minimum Length Check (Optional but recommended)
    if (username.length < 3) {
        return { valid: false, error: "Username must be at least 3 characters." };
    }

    // 3. Profanity / Slur Filter
    const lowerName = username.toLowerCase();

    // Check against the loaded list
    for (const word of bannedWords) {
        // We check if the username INCLUDES the bad word
        // e.g. "BadWord123" contains "BadWord"
        if (lowerName.includes(word)) {
            return { valid: false, error: "Username contains restricted words." };
        }
    }

    return { valid: true };
}

// --- UPDATED NOTIFICATION SYSTEM ---
function sendNotification(title, body, channelId) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    // The user requested: Online or Idle.
    // We block if status is 'dnd' or 'invisible' (Offline)
    const myStatus = currentUser.customStatus || 'online';
    if (myStatus === 'dnd' || myStatus === 'invisible') return;

    if (document.hidden) {
        const notif = new Notification("TrioChat: " + title, {
            body: body,
            icon: '/favicon.ico', 
            tag: channelId, // Groups notifications from the same channel
            silent: false
        });
        
        notif.onclick = () => { 
            window.focus();
            // Optional: add logic here to switch to the specific channel
        };
    }
}

async function adminAction(type, targetUid) {
    const userRef = doc(db, "users", targetUid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();

    if (type === 'warn') {
        const reason = prompt("Enter warning reason:");
        if (!reason) return;
        const newWarnings = userData.warnings || [];
        newWarnings.push({ reason, date: new Date(), by: currentUser.displayName });
        await updateDoc(userRef, { warnings: newWarnings });
        alert("User warned.");
    } 
    else if (type === 'mute') {
        const isMuted = !userData.isMuted;
        await updateDoc(userRef, { isMuted: isMuted });
        alert(isMuted ? "User muted." : "User unmuted.");
    } 
    else if (type === 'ban') {
        if (confirm("Are you sure you want to PERMANENTLY ban this user?")) {
            await updateDoc(userRef, { isBanned: true });
            alert("User banned.");
        }
    }
}
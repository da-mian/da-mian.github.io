// Quiz Questions - English
const questions = [
    {
        title: "Rule #1 for budget travel?",
        answers: [
            "Carry-on = everything",
            "Only the essentials (plus chargers)",
            "If it's a deal, it's destiny"
        ],
        feedback: "Exactly! And somehow it always works out."
    },
    {
        title: "What must an 'under-seat' backpack do?",
        answers: [
            "Fit under the seat - no questions asked",
            "Hold more than it promises",
            "Quick access: passport, headphones, snacks"
        ],
        feedback: "Look, I'm sure it fits under the seat..."
    },
    {
        title: "Temu bargain alert! What happens next?",
        answers: [
            "Think briefly (for 0.7 seconds)",
            "Add to cart. Rationalize later.",
            "Ask Damian first... then buy anyway."
        ],
        feedback: "I love how you always find the best deals!"
    }
];

// DOM Elements
const screens = {
    start: document.getElementById('start-screen'),
    travelMode: document.getElementById('travel-mode-screen'),
    quiz: document.getElementById('quiz-screen'),
    scan: document.getElementById('scan-screen'),
    unlock: document.getElementById('unlock-screen'),
    celebration: document.getElementById('celebration-screen')
};

// Navigation Functions
function showScreen(screenId) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    const nextScreen = screens[screenId];
    nextScreen.classList.add('active');
    nextScreen.scrollTop = 0;
}

function hideElement(element) {
    element.classList.add('hidden');
}

function showElement(element) {
    element.classList.remove('hidden');
}

// Event Listeners
function setupEventListeners() {
    // Start Button
    document.getElementById('start-btn').addEventListener('click', () => {
        showScreen('travelMode');
    });

    // Travel Mode Selection with fun animations
    document.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => {
            // Add selected class to clicked card
            card.classList.add('selected');
            
            // Hide other cards with animation
            document.querySelectorAll('.card:not(.selected)').forEach(c => {
                c.style.opacity = '0';
                c.style.transform = 'perspective(1000px) rotateY(20deg) scale(0.9)';
            });
            
            // Show feedback after animation
            setTimeout(() => {
                const cardContainer = document.querySelector('#travel-mode-screen .card-container');
                if (cardContainer) {
                    cardContainer.style.display = 'none';
                }
                showElement(document.getElementById('mode-feedback'));
            }, 500);
        });
    });

    // Continue from Travel Mode
    document.getElementById('continue-btn').addEventListener('click', () => {
        showScreen('quiz');
        showQuestion(0);
    });

    // Quiz Navigation (this will be handled in showQuestion function)

    // Unlock Button with sound
    document.getElementById('unlock-btn').addEventListener('click', () => {
        playSound('scan');
        showScreen('unlock');
    });

    // Hold to Unlock - Enhanced for both mouse and touch
    let holdTimer;
    let isHolding = false;
    const holdButton = document.getElementById('hold-unlock-btn');
    const unlockInstructions = document.getElementById('unlock-instructions');
    
    // Visual feedback for holding
    function startHold() {
        isHolding = true;
        holdButton.style.backgroundColor = '#c0392b';
        holdButton.textContent = 'Holding... (2 sec)';
        console.log('Hold started');
        
        // Show expanding circle overlay
        const circleOverlay = document.getElementById('expanding-circle-overlay');
        const circleContent = document.getElementById('expanding-circle-content');
        const circleEmojis = document.getElementById('expanding-circle-emojis');

        // Position effects at the button (not the center of the screen)
        const rect = holdButton.getBoundingClientRect();
        const originX = rect.left + rect.width / 2;
        const originY = rect.top + rect.height / 2;
        document.documentElement.style.setProperty('--unlock-origin-x', `${originX}px`);
        document.documentElement.style.setProperty('--unlock-origin-y', `${originY}px`);

        // Ensure orbit emoji elements exist
        if (circleEmojis && !circleEmojis.querySelector('.orbit')) {
            const orbit = document.createElement('div');
            orbit.className = 'orbit';
            const emojiSet = ['🔓', '🎁', '🔓', '🎁', '🔓', '🎁', '🔓', '🎁'];
            const count = emojiSet.length;
            const radius = 62; // px
            for (let index = 0; index < count; index++) {
                const angle = (index / count) * Math.PI * 2;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                const span = document.createElement('span');
                span.className = 'orbit-emoji';
                span.textContent = emojiSet[index];
                span.style.setProperty('--orbit-x', `${x}px`);
                span.style.setProperty('--orbit-y', `${y}px`);
                span.style.animationDelay = `${index * 60}ms`;
                orbit.appendChild(span);
            }
            circleEmojis.textContent = '';
            circleEmojis.appendChild(orbit);
        }
        
        circleOverlay.classList.add('active');
        circleContent.classList.add('active');
        circleEmojis.classList.add('active');
        
        holdTimer = setTimeout(() => {
            if (isHolding) {
                showElement(document.getElementById('reveal-content'));
                hideElement(holdButton);
                hideElement(unlockInstructions); // Hide all instructions
                circleOverlay.classList.remove('active'); // Hide circle overlay
                circleContent.classList.remove('active'); // Hide content
                circleEmojis.classList.remove('active'); // Hide emojis
                triggerConfetti();
                console.log('Hold completed - revealing content');
            }
        }, 2000);
    }
    
    function cancelHold() {
        isHolding = false;
        holdButton.style.backgroundColor = '';
        holdButton.textContent = 'Unlock Surprise';
        
        // Clean up expanding circle overlay
        const circleOverlay = document.getElementById('expanding-circle-overlay');
        const circleContent = document.getElementById('expanding-circle-content');
        const circleEmojis = document.getElementById('expanding-circle-emojis');
        
        circleOverlay.classList.remove('active');
        circleContent.classList.remove('active');
        circleEmojis.classList.remove('active');
        
        clearTimeout(holdTimer);
        console.log('Hold cancelled');
    }

    // Prevent iOS context menu interfering with long press
    holdButton.addEventListener('contextmenu', (e) => e.preventDefault());

    // Prefer Pointer Events (more reliable on mobile Safari)
    if (window.PointerEvent) {
        holdButton.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (holdButton.setPointerCapture) holdButton.setPointerCapture(e.pointerId);
            startHold();
        });
        holdButton.addEventListener('pointerup', (e) => {
            e.preventDefault();
            cancelHold();
        });
        holdButton.addEventListener('pointercancel', (e) => {
            e.preventDefault();
            cancelHold();
        });
        holdButton.addEventListener('pointerleave', cancelHold);
    } else {
        // Mouse events
        holdButton.addEventListener('mousedown', startHold);
        holdButton.addEventListener('mouseup', cancelHold);
        holdButton.addEventListener('mouseleave', cancelHold);

        // Touch events for mobile (non-pointer fallback)
        holdButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startHold();
        }, { passive: false });

        holdButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            cancelHold();
        }, { passive: false });

        holdButton.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            cancelHold();
        }, { passive: false });
    }

    // Final Button - Show celebration screen
    document.getElementById('final-btn').addEventListener('click', () => {
        showScreen('celebration');
    });
}

// Quiz Functions
let currentQuestionIndex = 0;

function showQuestion(index) {
    console.log('showQuestion called with index:', index);
    const question = questions[index];
    const container = document.getElementById('question-container');
    const feedbackElement = document.getElementById('quiz-feedback');
    
    // Hide feedback if visible
    feedbackElement.classList.add('hidden');
    
    container.innerHTML = `
        <h2>${question.title}</h2>
        <div class="answers">
            ${question.answers.map(answer => `
                <button class="answer-btn btn">${answer}</button>
            `).join('')}
        </div>
    `;

    // Add event listeners to answer buttons
    document.querySelectorAll('.answer-btn').forEach(button => {
        button.addEventListener('click', () => {
            console.log('Answer button clicked for question:', index);
            showQuestionFeedback(index);
        });
    });
}

function showQuestionFeedback(index) {
    const question = questions[index];
    const feedbackElement = document.getElementById('quiz-feedback');
    
    console.log('showQuestionFeedback called for index:', index);
    
    // Play sound for correct answer
    playSound('unlock');
    
    // Cycle through available images for each question
    const photoImages = [
        'proof-weve-got-this.jpg',
        'travel-mode-everything-under-the-seat.jpg',
        'deal-hunter-favorite-human.gif'  // Use GIF for last question
    ];
    const photoCaptions = [
        'Proof: We can do this!',
        'Deal hunter & favorite person.',
        'Deal hunter & favorite human! 🎉'
    ];
    
    const imageIndex = index % photoImages.length;
    
    feedbackElement.innerHTML = `
        <p class="fun-feedback">${question.feedback}</p>
        <div class="polaroid">
            <img src="images/${photoImages[imageIndex]}" alt="Photo">
        </div>
        <button id="next-question-btn" class="btn">${index < questions.length - 1 ? 'Next Question' : 'Continue'}</button>
    `;
    
    console.log('Hiding question container, showing feedback');
    showElement(feedbackElement);
    hideElement(document.getElementById('question-container'));
    
    // Add event listener to the next button using event delegation pattern
    document.getElementById('next-question-btn').onclick = function() {
        console.log('Next button clicked, current index:', currentQuestionIndex);
        currentQuestionIndex++;
        console.log('New index:', currentQuestionIndex);
        if (currentQuestionIndex < questions.length) {
            console.log('Showing next question');
            // Hide feedback and show question container
            hideElement(document.getElementById('quiz-feedback'));
            showElement(document.getElementById('question-container'));
            showQuestion(currentQuestionIndex);
        } else {
            console.log('All questions answered, showing scan screen');
            showScreen('scan');
        }
    };
}

// Initialize
function init() {
    setupEventListeners();
    registerServiceWorker();
}

// Service Worker Registration
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            // Register relative to current path (important for GitHub Pages subpaths)
            navigator.serviceWorker.register('sw.js')
                .then(registration => {
                    console.log('ServiceWorker registration successful');
                })
                .catch(err => {
                    console.log('ServiceWorker registration failed: ', err);
                });
        });
    }
}

// Enhanced Confetti Animation
function triggerConfetti() {
    const colors = ['#ff6b6b', '#feca57', '#54a0ff', '#00d2d3', '#ff9ff3', '#48dbfb'];

    // Big double-cannon burst
    confetti({
        particleCount: 220,
        spread: 70,
        startVelocity: 55,
        decay: 0.9,
        scalar: 1.2,
        colors,
        origin: { x: 0.18, y: 0.72 }
    });

    confetti({
        particleCount: 220,
        spread: 70,
        startVelocity: 55,
        decay: 0.9,
        scalar: 1.2,
        colors,
        origin: { x: 0.82, y: 0.72 }
    });

    // Sparkly "wow" drizzle for ~1.2s
    const durationMs = 1200;
    const endTime = Date.now() + durationMs;

    (function frame() {
        confetti({
            particleCount: 8,
            startVelocity: 20,
            spread: 120,
            ticks: 140,
            gravity: 0.9,
            scalar: 0.9,
            colors,
            shapes: ['circle', 'square'],
            origin: { x: Math.random(), y: Math.random() * 0.35 + 0.05 }
        });
        if (Date.now() < endTime) {
            requestAnimationFrame(frame);
        }
    })();
    
    // Play sound effect if available
    playSound('celebration');
}

// Sound effects
function playSound(type) {
    try {
        let soundUrl = '';
        switch(type) {
            case 'celebration':
                soundUrl = 'https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3';
                break;
            case 'scan':
                soundUrl = 'https://assets.mixkit.co/sfx/preview/mixkit-scifi-alarm-995.mp3';
                break;
            case 'unlock':
                soundUrl = 'https://assets.mixkit.co/sfx/preview/mixkit-positive-notification-951.mp3';
                break;
        }
        
        if (soundUrl) {
            const audio = new Audio(soundUrl);
            audio.volume = 0.3;
            audio.play();
        }
    } catch (e) {
        console.log('Sound playback not supported or failed');
    }
}

// Start the app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

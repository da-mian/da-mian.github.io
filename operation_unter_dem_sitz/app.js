const screens = Array.from(document.querySelectorAll('.screen'));
const floating = document.querySelector('.floating');
const startBtn = document.getElementById('start-btn');
const modeCards = document.querySelectorAll('.mode-card');
const modeReaction = document.getElementById('mode-reaction');
const modePolaroid = document.getElementById('mode-polaroid');
const modeNext = document.getElementById('mode-next');
const quizTitle = document.getElementById('quiz-title');
const questionTitle = document.getElementById('question-title');
const answersEl = document.getElementById('answers');
const feedbackEl = document.getElementById('answer-feedback');
const quizNext = document.getElementById('quiz-next');
const quizPolaroid = document.getElementById('quiz-polaroid');
const quizPhoto = document.getElementById('quiz-photo');
const quizCaption = document.getElementById('quiz-caption');
const scanNext = document.getElementById('scan-next');
const holdBtn = document.getElementById('hold-btn');
const holdProgress = document.getElementById('hold-progress');
const holdInstruction = document.getElementById('hold-instruction');
const confettiCanvas = document.getElementById('confetti-canvas');

let currentScreen = 'screen-start';
let currentQuestion = 0;
let holdTimer;
let holdProgressInterval;
let confettiActive = false;

const quizData = [
  {
    question: 'Rule #1 of frugal travel?',
    answers: [
      'Carry-on = everything',
      'Only the essentials (plus chargers)',
      'If it’s a deal, it’s destiny'
    ],
    feedback: 'True. And somehow it always works.',
    photo: { src: './assets/proof-weve-got-this.jpg', caption: 'Proof: we’ve got this.' }
  },
  {
    question: 'What must an “under-the-seat” backpack do?',
    answers: [
      'Fit under the seat without debate',
      'Swallow more than it promises',
      'Keep passport, headphones, snacks in reach'
    ],
    feedback: 'You just wrote the perfect product description.',
    photo: { src: './assets/travel-mode-everything-under-the-seat.jpg', caption: 'Travel mode: everything under the seat.' }
  },
  {
    question: 'Temu alarm: what happens when there’s a bargain?',
    answers: [
      'Think briefly (0.7 seconds)',
      'Add to cart. Explain later.',
      'Ask Damian… and then do it anyway.'
    ],
    feedback: 'I love that you always find the best deal.',
    photo: { src: './assets/deal-hunter-favorite-human.gif', caption: 'Deal-hunter & favorite human.' }
  }
];

function showScreen(id) {
  screens.forEach((s) => s.classList.toggle('active', s.id === id));
  currentScreen = id;
}

function setupFloating() {
  for (let i = 0; i < 16; i++) {
    const dot = document.createElement('span');
    dot.style.left = Math.random() * 100 + '%';
    dot.style.bottom = -10 + Math.random() * 40 + 'px';
    dot.style.animationDelay = -Math.random() * 12 + 's';
    dot.style.animationDuration = 10 + Math.random() * 6 + 's';
    floating.appendChild(dot);
  }
}

function loadQuestion() {
  const item = quizData[currentQuestion];
  quizTitle.textContent = `Mini quiz – Question ${currentQuestion + 1} of ${quizData.length}`;
  questionTitle.textContent = item.question;
  answersEl.innerHTML = '';
  feedbackEl.style.display = 'none';
  quizNext.disabled = true;
  quizPolaroid.style.display = 'none';

  item.answers.forEach((ans) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = ans;
    btn.addEventListener('click', () => {
      feedbackEl.textContent = item.feedback;
      feedbackEl.style.display = 'flex';
      quizNext.disabled = false;
      if (item.photo) {
        quizPolaroid.style.display = 'block';
        quizPhoto.src = item.photo.src;
        quizCaption.textContent = item.photo.caption;
      } else {
        quizPolaroid.style.display = 'none';
      }
      Array.from(answersEl.children).forEach((b) => (b.disabled = true));
    });
    answersEl.appendChild(btn);
  });
}

function startHoldProgress() {
  resetHold();
  let progress = 0;
  holdInstruction.textContent = 'Holding…';
  holdTimer = setTimeout(() => {
    holdInstruction.textContent = 'Unlocked!';
    triggerConfetti();
    showScreen('screen-reveal');
  }, 2000);

  holdProgressInterval = setInterval(() => {
    progress += 5;
    holdProgress.style.width = Math.min(progress, 100) + '%';
  }, 100);
}

function resetHold() {
  clearTimeout(holdTimer);
  clearInterval(holdProgressInterval);
  holdProgress.style.width = '0%';
  holdInstruction.textContent = 'Press and hold…';
}

function triggerConfetti() {
  if (confettiActive) return;
  confettiActive = true;
  const ctx = confettiCanvas.getContext('2d');
  const particles = [];
  resizeCanvas();
  for (let i = 0; i < 160; i++) {
    particles.push({
      x: Math.random() * confettiCanvas.width,
      y: Math.random() * confettiCanvas.height - confettiCanvas.height,
      r: Math.random() * 6 + 4,
      c: Math.random() > 0.5 ? '#f1c40f' : '#7cf5ff',
      v: Math.random() * 3 + 2,
      a: Math.random() * 0.02 + 0.01
    });
  }

  function draw() {
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    particles.forEach((p) => {
      ctx.fillStyle = p.c;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.y * p.a);
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
      p.y += p.v;
      p.x += Math.sin(p.y * p.a) * 2;
      if (p.y > confettiCanvas.height) p.y = -10;
    });
    requestAnimationFrame(draw);
  }
  draw();
  setTimeout(() => {
    confettiActive = false;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }, 2500);
}

function resizeCanvas() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}

startBtn.addEventListener('click', () => showScreen('screen-mode'));

modeCards.forEach((card) => {
  card.addEventListener('click', () => {
    modeCards.forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    modeReaction.textContent =
      'Great pick. I know you: clever first – and somehow everything fits.';
    modePolaroid.style.display = 'block';
    modeNext.disabled = false;
  });
});

modeNext.addEventListener('click', () => {
  currentQuestion = 0;
  loadQuestion();
  showScreen('screen-quiz');
});

quizNext.addEventListener('click', () => {
  if (currentQuestion < quizData.length - 1) {
    currentQuestion += 1;
    loadQuestion();
  } else {
    showScreen('screen-scan');
  }
});

scanNext.addEventListener('click', () => showScreen('screen-hold'));

holdBtn.addEventListener('pointerdown', startHoldProgress);
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
  holdBtn.addEventListener(ev, () => {
    if (currentScreen === 'screen-hold') {
      resetHold();
    }
  });
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
setupFloating();

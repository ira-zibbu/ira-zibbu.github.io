const BASES = ["A", "T", "G", "C"];

function makeSeededRandom(seed) {
  let s = seed;
  return function rand() {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function buildGenomeOfLength(length, seed) {
  const rand = makeSeededRandom(seed);
  let seq = "";
  for (let i = 0; i < length; i++) {
    seq += BASES[Math.floor(rand() * 4)];
  }
  return seq;
}

// Deterministic toy genomes, stable across reloads.
const GENOME_LENGTH = 30;
const REFERENCE_GENOME = buildGenomeOfLength(GENOME_LENGTH, 42);

const LEVEL3_GENOME_LENGTH = 40;
const LEVEL3_GENOME = buildGenomeOfLength(LEVEL3_GENOME_LENGTH, 99);

const LEVELS = [
  {
    id: "level1",
    numRounds: 5,
    mode: "single-lane",
    genome: REFERENCE_GENOME,
    genomeLength: GENOME_LENGTH,
    readLength: 8,
    hasSnp: false,
    hasDeletion: false,
  },
  {
    id: "level2",
    numRounds: 5,
    mode: "pileup",
    genome: REFERENCE_GENOME,
    genomeLength: GENOME_LENGTH,
    readLength: 8,
    hasSnp: true,
    hasDeletion: false,
    snpPos: 12, // 0-indexed -> the 13th base
  },
  {
    id: "level3",
    numRounds: 5,
    mode: "pileup",
    genome: LEVEL3_GENOME,
    genomeLength: LEVEL3_GENOME_LENGTH,
    readLength: 12,
    hasSnp: false,
    hasDeletion: true,
    deletionStart: 16, // 0-indexed -> the 17th base
    deletionEnd: 22, // 0-indexed, inclusive -> the 23rd base
  },
];

const state = {
  levelIndex: 0,
  level: null,
  rounds: [],
  currentIndex: 0,
  placedCol: null,
  attemptsThisRound: 0,
  cleanSolves: 0,
  totalAttempts: 0,
  trackCellEls: [],
  currentPillEl: null,
  currentLaneRow: 1,
  snpInfo: null,
  deletionInfo: null,
};

function baseSpan(letter) {
  const span = document.createElement("span");
  span.className = `base base-${letter}`;
  span.textContent = letter;
  return span;
}

function renderGenomeStrip(container, genome) {
  container.innerHTML = "";
  for (const letter of genome) {
    container.appendChild(baseSpan(letter));
  }
}

function buildRoundsForLevel(level) {
  const maxStart = level.genomeLength - level.readLength;

  if (level.hasDeletion) {
    return buildDeletionRounds(level, maxStart);
  }
  if (level.hasSnp) {
    return buildSnpRounds(level, maxStart);
  }

  const offsets = [];
  while (offsets.length < level.numRounds) {
    const candidate = Math.floor(Math.random() * (maxStart + 1));
    if (!offsets.includes(candidate)) offsets.push(candidate);
  }
  return {
    rounds: offsets.map((start) => ({
      read: level.genome.slice(start, start + level.readLength),
      correctPos: start,
      coversSnp: false,
      pillEl: null,
    })),
    snpInfo: null,
    deletionInfo: null,
  };
}

function buildSnpRounds(level, maxStart) {
  const snpPos = level.snpPos;
  const refBase = level.genome[snpPos];
  const altBase = BASES.filter((b) => b !== refBase)[
    Math.floor(Math.random() * 3)
  ];

  const coveringStarts = [];
  for (let s = Math.max(0, snpPos - level.readLength + 1); s <= Math.min(maxStart, snpPos); s++) {
    coveringStarts.push(s);
  }
  const nonCoveringStarts = [];
  for (let s = 0; s <= maxStart; s++) {
    if (!coveringStarts.includes(s)) nonCoveringStarts.push(s);
  }

  const chosenCovering = [];
  const coveringPool = [...coveringStarts];
  while (chosenCovering.length < 4 && coveringPool.length > 0) {
    const i = Math.floor(Math.random() * coveringPool.length);
    chosenCovering.push(coveringPool.splice(i, 1)[0]);
  }
  const chosenNonCovering =
    nonCoveringStarts[Math.floor(Math.random() * nonCoveringStarts.length)];

  const starts = [...chosenCovering, chosenNonCovering];
  shuffle(starts);

  const rounds = starts.map((start) => {
    const covers = start <= snpPos && snpPos <= start + level.readLength - 1;
    const chars = level.genome.slice(start, start + level.readLength).split("");
    let snpIndexInRead = null;
    if (covers) {
      snpIndexInRead = snpPos - start;
      chars[snpIndexInRead] = altBase;
    }
    return {
      read: chars.join(""),
      correctPos: start,
      coversSnp: covers,
      snpIndexInRead,
      pillEl: null,
    };
  });

  return { rounds, snpInfo: { snpPos, refBase, altBase }, deletionInfo: null };
}

function buildDeletionRounds(level, maxStart) {
  const { deletionStart, deletionEnd, readLength } = level;

  // Tile both flanks so every base outside the deletion is covered by at
  // least one read, with none touching the deleted region.
  const leftFlankEnd = deletionStart - 1;
  const rightFlankStart = deletionEnd + 1;

  const validStarts = [];
  for (let s = 0; s <= maxStart; s++) {
    const end = s + readLength - 1;
    if (end < deletionStart || s > deletionEnd) validStarts.push(s);
  }

  const leftStarts = [];
  for (let s = 0; s + readLength - 1 <= leftFlankEnd; s += readLength) {
    leftStarts.push(s);
  }
  // Make sure the last base of the left flank is covered.
  const lastLeftStart = leftFlankEnd - readLength + 1;
  if (lastLeftStart >= 0 && leftStarts[leftStarts.length - 1] !== lastLeftStart) {
    leftStarts.push(lastLeftStart);
  }

  const rightStarts = [];
  for (let s = rightFlankStart; s <= maxStart; s += readLength) {
    rightStarts.push(s);
  }
  const lastRightStart = maxStart;
  if (rightStarts[rightStarts.length - 1] !== lastRightStart) {
    rightStarts.push(lastRightStart);
  }

  const starts = [...leftStarts, ...rightStarts];

  // A longer read length can fully tile both flanks in fewer reads than
  // numRounds — pad with extra valid (non-gap) reads to keep the round
  // count consistent with the other levels.
  const remainingPool = validStarts.filter((s) => !starts.includes(s));
  while (starts.length < level.numRounds && remainingPool.length > 0) {
    const i = Math.floor(Math.random() * remainingPool.length);
    starts.push(remainingPool.splice(i, 1)[0]);
  }
  while (starts.length < level.numRounds) {
    starts.push(validStarts[Math.floor(Math.random() * validStarts.length)]);
  }

  shuffle(starts);

  const rounds = starts.map((start) => ({
    read: level.genome.slice(start, start + readLength),
    correctPos: start,
    coversSnp: false,
    pillEl: null,
  }));

  return {
    rounds,
    snpInfo: null,
    deletionInfo: { deletionStart, deletionEnd },
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function renderTrack(level) {
  const track = document.getElementById("track");
  track.innerHTML = "";
  state.trackCellEls = [];

  const numLanes = level.mode === "pileup" ? state.rounds.length : 1;
  const totalRows = numLanes + 1;
  const referenceRow = totalRows;
  track.style.gridTemplateColumns = `repeat(${level.genomeLength}, 1fr)`;
  track.style.gridTemplateRows = `repeat(${totalRows}, 54px)`;
  state.referenceRow = referenceRow;

  for (let i = 0; i < level.genomeLength; i++) {
    const cell = document.createElement("div");
    cell.className = `track-cell base-${level.genome[i]}`;
    cell.textContent = level.genome[i];
    cell.style.gridColumn = `${i + 1} / span 1`;
    cell.style.gridRow = String(referenceRow);
    track.appendChild(cell);
    state.trackCellEls.push(cell);
  }
}

function createReadPill(readStr) {
  const pill = document.createElement("div");
  pill.className = "read-pill";
  pill.draggable = true;
  for (const letter of readStr) {
    pill.appendChild(baseSpan(letter));
  }
  pill.addEventListener("dragstart", onDragStart);
  pill.addEventListener("dragend", onDragEnd);
  return pill;
}

function onDragStart(e) {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "read");
  e.target.classList.add("dragging");
}

function onDragEnd(e) {
  e.target.classList.remove("dragging");
}

function nearestStartColumn(clientX) {
  let nearestIndex = 0;
  let minDist = Infinity;
  state.trackCellEls.forEach((cell, i) => {
    const rect = cell.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const dist = Math.abs(clientX - center);
    if (dist < minDist) {
      minDist = dist;
      nearestIndex = i;
    }
  });
  const maxStart = state.level.genomeLength - state.level.readLength;
  return Math.min(Math.max(nearestIndex, 0), maxStart);
}

function placePillAt(col) {
  if (!state.currentPillEl) return;
  const pill = state.currentPillEl;
  const track = document.getElementById("track");
  pill.style.gridColumn = `${col + 1} / span ${state.level.readLength}`;
  pill.style.gridRow = String(state.currentLaneRow);
  pill.classList.add("placed");
  track.appendChild(pill);
  state.placedCol = col;
  clearFeedback();
}

function clearFeedback() {
  const feedback = document.getElementById("feedback");
  feedback.textContent = "";
  feedback.className = "feedback";
  state.trackCellEls.forEach((c) =>
    c.classList.remove("correct-flash", "incorrect-flash")
  );
}

function setupTrackDropZone() {
  const track = document.getElementById("track");
  track.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  track.addEventListener("drop", (e) => {
    e.preventDefault();
    const col = nearestStartColumn(e.clientX);
    placePillAt(col);
  });
}

function currentRound() {
  return state.rounds[state.currentIndex];
}

function loadRound(index) {
  state.currentIndex = index;
  state.placedCol = null;
  state.attemptsThisRound = 0;

  const round = currentRound();

  if (state.level.mode !== "pileup" && state.currentPillEl) {
    state.currentPillEl.remove();
  }

  const tray = document.getElementById("read-tray");
  tray.innerHTML = "";
  const pill = createReadPill(round.read);
  state.currentPillEl = pill;
  round.pillEl = pill;
  tray.appendChild(pill);

  clearFeedback();
  document.getElementById("check-btn").classList.remove("hidden");
  document.getElementById("next-btn").classList.add("hidden");
  document.getElementById("insight-prompt").classList.add("hidden");
  document.getElementById("insight-answer-input").value = "";
  document.getElementById("insight-callout").classList.add("hidden");
  document.getElementById("round-indicator").textContent =
    `Read ${index + 1} of ${state.rounds.length}`;
  document.getElementById("score-indicator").textContent =
    `Score: ${index} of ${state.rounds.length} solved`;
}

function checkAlignment() {
  const feedback = document.getElementById("feedback");

  if (state.placedCol === null) {
    feedback.textContent = "Drag the read onto the genome first!";
    feedback.className = "feedback incorrect";
    return;
  }

  state.totalAttempts++;
  state.attemptsThisRound++;
  const round = currentRound();
  const isCorrect = state.placedCol === round.correctPos;
  const affectedCells = state.trackCellEls.slice(
    state.placedCol,
    state.placedCol + state.level.readLength
  );

  if (isCorrect) {
    feedback.textContent = `Correct! The read aligns at position ${round.correctPos + 1}.`;
    feedback.className = "feedback correct";
    affectedCells.forEach((c) => c.classList.add("correct-flash"));
    if (state.attemptsThisRound === 1) state.cleanSolves++;

    if (state.level.mode === "pileup") {
      state.currentPillEl.classList.add("locked");
      state.currentPillEl.draggable = false;
      state.currentLaneRow++;
    }

    document.getElementById("check-btn").classList.add("hidden");

    const isLastRound = state.currentIndex + 1 >= state.rounds.length;
    const hasInsight = state.level.hasSnp || state.level.hasDeletion;
    if (isLastRound && hasInsight) {
      document.getElementById("insight-prompt").classList.remove("hidden");
    } else {
      document.getElementById("next-btn").classList.remove("hidden");
    }
  } else {
    feedback.textContent = "Not quite — try dragging the read to a different spot.";
    feedback.className = "feedback incorrect";
    affectedCells.forEach((c) => c.classList.add("incorrect-flash"));
  }
}

function revealInsight() {
  if (state.level.hasSnp) {
    revealSnp();
  } else if (state.level.hasDeletion) {
    revealDeletion();
  }
}

function revealSnp() {
  const { snpPos, refBase, altBase } = state.snpInfo;

  state.trackCellEls[snpPos].classList.add("snp-highlight");

  let coveringCount = 0;
  state.rounds.forEach((round) => {
    if (round.coversSnp && round.pillEl) {
      const baseEls = round.pillEl.querySelectorAll(".base");
      baseEls[round.snpIndexInRead].classList.add("snp-highlight");
      coveringCount++;
    }
  });

  document.getElementById("insight-callout").innerHTML = `
    <strong>SNP detected at position ${snpPos + 1}!</strong>
    The reference has <span class="base base-${refBase} inline-base">${refBase}</span>,
    but ${coveringCount} of your ${state.rounds.length} reads show
    <span class="base base-${altBase} inline-base">${altBase}</span> at that exact spot.
    When many independent reads agree on a different base than the reference, that's
    exactly how real aligners and variant-calling tools flag a single nucleotide
    polymorphism (SNP) — a true, reproducible mutation instead of a random error.
  `;
  finishReveal("Learn About Coverage →");
}

function revealDeletion() {
  const { deletionStart, deletionEnd } = state.deletionInfo;

  for (let i = deletionStart; i <= deletionEnd; i++) {
    state.trackCellEls[i].classList.add("deletion-highlight");
  }

  document.getElementById("insight-callout").innerHTML = `
    <strong>Zero coverage at positions ${deletionStart + 1}-${deletionEnd + 1}!</strong>
    None of your 5 reads cover this stretch, even though your reads tile the rest of
    the genome cleanly on both sides. A gap like this — well-covered flanks with
    nothing in between — is exactly the signature of a deletion: that piece of DNA
    simply isn't present in the sample, so no read can ever be sequenced from it.
    Coverage gaps like this are one of the key ways aligners help scientists spot
    larger structural changes, not just single-base differences like the SNP you saw
    earlier.
  `;
  finishReveal("See Final Results →");
}

function finishReveal(nextBtnLabel) {
  document.getElementById("insight-callout").classList.remove("hidden");
  document.getElementById("insight-prompt").classList.add("hidden");
  document.getElementById("next-btn").classList.remove("hidden");
  document.getElementById("next-btn").textContent = nextBtnLabel;
}

function goToNextRound() {
  if (state.currentIndex + 1 < state.rounds.length) {
    loadRound(state.currentIndex + 1);
    return;
  }
  advanceAfterLevel();
}

function advanceAfterLevel() {
  const nextLevelIndex = state.levelIndex + 1;
  if (nextLevelIndex >= LEVELS.length) {
    showSummary();
    return;
  }
  const nextLevel = LEVELS[nextLevelIndex];
  if (nextLevel.hasSnp) {
    showLevelSummary();
  } else if (nextLevel.hasDeletion) {
    showView("coverage-intro-view");
  }
}

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function showLevelSummary() {
  document.getElementById("level-summary-text").textContent =
    `You aligned all ${state.rounds.length} reads, getting ${state.cleanSolves} of ` +
    `${state.rounds.length} correct on the first try. The reads you had came from a sample ` +
    `with no mutations. Let's look at another sample.`;
  showView("level-summary-view");
}

function showSummary() {
  document.getElementById("summary-text").textContent =
    `You made it through all three samples in ${state.totalAttempts} total attempts, and saw ` +
    `firsthand how piling up reads can reveal both a SNP and a deletion!`;
  showView("summary-view");
}

function startLevel(levelIndex) {
  state.levelIndex = levelIndex;
  state.level = LEVELS[levelIndex];
  state.cleanSolves = 0;
  state.currentLaneRow = 1;

  const built = buildRoundsForLevel(state.level);
  state.rounds = built.rounds;
  state.snpInfo = built.snpInfo;
  state.deletionInfo = built.deletionInfo;

  document.getElementById("next-btn").textContent = "Next Read →";

  renderTrack(state.level);
  loadRound(0);
  showView("align-view");
}

function init() {
  renderGenomeStrip(document.getElementById("genome-strip-1"), REFERENCE_GENOME);
  setupTrackDropZone();

  document.getElementById("intro-reference-next-btn").addEventListener("click", () =>
    showView("intro-read-view")
  );
  document.getElementById("intro-read-next-btn").addEventListener("click", () =>
    showView("intro-aligner-view")
  );
  document.getElementById("intro-aligner-next-btn").addEventListener("click", () =>
    showView("genome-view")
  );
  document.getElementById("start-btn").addEventListener("click", () => startLevel(0));
  document.getElementById("check-btn").addEventListener("click", checkAlignment);
  document.getElementById("next-btn").addEventListener("click", goToNextRound);
  document.getElementById("reveal-insight-btn").addEventListener("click", revealInsight);
  document.getElementById("continue-level2-btn").addEventListener("click", () =>
    startLevel(1)
  );
  document.getElementById("coverage-intro-next-btn").addEventListener("click", () =>
    startLevel(2)
  );
  document.getElementById("replay-btn").addEventListener("click", () => startLevel(0));
}

document.addEventListener("DOMContentLoaded", init);

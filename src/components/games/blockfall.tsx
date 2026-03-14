"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react";

type Matrix = number[][];
type Board = number[][];
type Piece = {
  matrix: Matrix;
  row: number;
  column: number;
  color: number;
};

const ROWS = 20;
const COLUMNS = 10;
const BEST_KEY = "arfor-blockfall-best";

const SHAPES: Matrix[] = [
  [[1, 1, 1, 1]],
  [
    [1, 1],
    [1, 1],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 0],
  ],
  [
    [1, 1, 0],
    [0, 1, 1],
  ],
  [
    [1, 0, 0],
    [1, 1, 1],
  ],
  [
    [0, 0, 1],
    [1, 1, 1],
  ],
];

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLUMNS).fill(0));
}

function randomShapeIndex() {
  return Math.floor(Math.random() * SHAPES.length);
}

function rotateMatrix(matrix: Matrix) {
  return matrix[0].map((_, columnIndex) =>
    matrix.map((row) => row[columnIndex]).reverse(),
  );
}

function createPiece(shapeIndex: number): Piece {
  const matrix = SHAPES[shapeIndex];
  return {
    matrix,
    row: 0,
    column: Math.floor((COLUMNS - matrix[0].length) / 2),
    color: shapeIndex + 1,
  };
}

function collides(board: Board, piece: Piece) {
  return piece.matrix.some((row, rowIndex) =>
    row.some((cell, columnIndex) => {
      if (!cell) return false;
      const nextRow = piece.row + rowIndex;
      const nextColumn = piece.column + columnIndex;

      return (
        nextColumn < 0 ||
        nextColumn >= COLUMNS ||
        nextRow >= ROWS ||
        (nextRow >= 0 && board[nextRow][nextColumn] !== 0)
      );
    }),
  );
}

function mergePiece(board: Board, piece: Piece) {
  const nextBoard = board.map((row) => [...row]);

  piece.matrix.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (!cell) {
        return;
      }

      const boardRow = piece.row + rowIndex;
      const boardColumn = piece.column + columnIndex;
      if (boardRow >= 0) {
        nextBoard[boardRow][boardColumn] = piece.color;
      }
    });
  });

  return nextBoard;
}

function clearFullRows(board: Board) {
  const keptRows = board.filter((row) => row.some((cell) => cell === 0));
  const cleared = ROWS - keptRows.length;

  while (keptRows.length < ROWS) {
    keptRows.unshift(Array(COLUMNS).fill(0));
  }

  return { board: keptRows, cleared };
}

function getLevel(lines: number) {
  return Math.floor(lines / 8) + 1;
}

function getCellClass(value: number) {
  if (value === 0) return "bg-white/5";
  if (value === 1) return "bg-[#ffd27d]";
  if (value === 2) return "bg-[#7cc4ff]";
  if (value === 3) return "bg-[#f7b3e8]";
  if (value === 4) return "bg-[#8fe3c0]";
  if (value === 5) return "bg-[#ff9b85]";
  if (value === 6) return "bg-[#c2b1ff]";
  return "bg-[#f7e6a1]";
}

export function BlockfallGame() {
  const [board, setBoard] = useState<Board>(createEmptyBoard);
  const [piece, setPiece] = useState<Piece>(() => createPiece(randomShapeIndex()));
  const [nextShapeIndex, setNextShapeIndex] = useState(() => randomShapeIndex());
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [best, setBest] = useState(0);
  const [running, setRunning] = useState(true);
  const [gameOver, setGameOver] = useState(false);

  const stateRef = useRef({
    board,
    piece,
    nextShapeIndex,
    score,
    lines,
    best,
    running,
    gameOver,
  });

  useEffect(() => {
    stateRef.current = {
      board,
      piece,
      nextShapeIndex,
      score,
      lines,
      best,
      running,
      gameOver,
    };
  }, [board, piece, nextShapeIndex, score, lines, best, running, gameOver]);

  useEffect(() => {
    const savedBest = window.localStorage.getItem(BEST_KEY);
    if (savedBest) {
      setBest(Number(savedBest));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(BEST_KEY, String(best));
  }, [best]);

  const level = useMemo(() => getLevel(lines), [lines]);
  const dropDelay = Math.max(140, 720 - (level - 1) * 60);

  function commitBest(nextScore: number) {
    setBest((current) => Math.max(current, nextScore));
  }

  function resetGame() {
    setBoard(createEmptyBoard());
    setPiece(createPiece(randomShapeIndex()));
    setNextShapeIndex(randomShapeIndex());
    setScore(0);
    setLines(0);
    setRunning(true);
    setGameOver(false);
  }

  function lockCurrentPiece(nextBoard: Board, nextScore: number, nextLines: number) {
    const spawned = createPiece(stateRef.current.nextShapeIndex);
    const followingShape = randomShapeIndex();

    if (collides(nextBoard, spawned)) {
      setBoard(nextBoard);
      setPiece(spawned);
      setNextShapeIndex(followingShape);
      setScore(nextScore);
      setLines(nextLines);
      setRunning(false);
      setGameOver(true);
      commitBest(nextScore);
      return;
    }

    setBoard(nextBoard);
    setPiece(spawned);
    setNextShapeIndex(followingShape);
    setScore(nextScore);
    setLines(nextLines);
    commitBest(nextScore);
  }

  function stepDown(softDrop = false) {
    const current = stateRef.current;
    if (!current.running || current.gameOver) {
      return;
    }

    const movedPiece = { ...current.piece, row: current.piece.row + 1 };
    if (!collides(current.board, movedPiece)) {
      setPiece(movedPiece);
      if (softDrop) {
        const nextScore = current.score + 1;
        setScore(nextScore);
        commitBest(nextScore);
      }
      return;
    }

    const mergedBoard = mergePiece(current.board, current.piece);
    const { board: clearedBoard, cleared } = clearFullRows(mergedBoard);
    const lineBonus = [0, 100, 300, 500, 800][cleared] ?? 0;
    const nextLines = current.lines + cleared;
    const nextScore = current.score + lineBonus * getLevel(nextLines);
    lockCurrentPiece(clearedBoard, nextScore, nextLines);
  }

  function moveHorizontally(offset: number) {
    const current = stateRef.current;
    if (!current.running || current.gameOver) {
      return;
    }

    const movedPiece = { ...current.piece, column: current.piece.column + offset };
    if (!collides(current.board, movedPiece)) {
      setPiece(movedPiece);
    }
  }

  function rotatePiece() {
    const current = stateRef.current;
    if (!current.running || current.gameOver) {
      return;
    }

    const rotated = { ...current.piece, matrix: rotateMatrix(current.piece.matrix) };
    if (!collides(current.board, rotated)) {
      setPiece(rotated);
      return;
    }

    const nudgedLeft = { ...rotated, column: rotated.column - 1 };
    if (!collides(current.board, nudgedLeft)) {
      setPiece(nudgedLeft);
      return;
    }

    const nudgedRight = { ...rotated, column: rotated.column + 1 };
    if (!collides(current.board, nudgedRight)) {
      setPiece(nudgedRight);
    }
  }

  function hardDrop() {
    let current = stateRef.current;
    if (!current.running || current.gameOver) {
      return;
    }

    let droppedPiece = current.piece;
    while (!collides(current.board, { ...droppedPiece, row: droppedPiece.row + 1 })) {
      droppedPiece = { ...droppedPiece, row: droppedPiece.row + 1 };
    }

    setPiece(droppedPiece);
    current = { ...current, piece: droppedPiece };
    stateRef.current = current;
    stepDown();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveHorizontally(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveHorizontally(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        stepDown(true);
      } else if (event.key === "ArrowUp" || event.key.toLowerCase() === "x") {
        event.preventDefault();
        rotatePiece();
      } else if (event.key === " ") {
        event.preventDefault();
        hardDrop();
      } else if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setRunning((currentRunning) => !currentRunning);
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetGame();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!running || gameOver) {
      return;
    }

    const timer = window.setInterval(() => stepDown(), dropDelay);
    return () => window.clearInterval(timer);
  }, [dropDelay, running, gameOver]);

  const previewBoard = useMemo(() => {
    const nextBoard = board.map((row) => [...row]);
    piece.matrix.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (!cell) {
          return;
        }

        const boardRow = piece.row + rowIndex;
        const boardColumn = piece.column + columnIndex;
        if (boardRow >= 0 && boardRow < ROWS && boardColumn >= 0 && boardColumn < COLUMNS) {
          nextBoard[boardRow][boardColumn] = piece.color;
        }
      });
    });

    return nextBoard;
  }, [board, piece]);

  const nextPreview = SHAPES[nextShapeIndex];

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-[32px] border border-white/8 bg-[rgba(5,5,7,0.55)] p-4 sm:p-5">
        <div className="mx-auto grid w-full max-w-[320px] grid-cols-10 gap-1 rounded-[24px] bg-white/5 p-3">
          {previewBoard.flat().map((value, index) => (
            <div
              key={index}
              className={`aspect-square rounded-[7px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${getCellClass(value)}`}
            />
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <div className="rounded-[28px] border border-white/8 bg-black/20 p-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={resetGame}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)] transition-colors hover:border-[var(--panel-border)]"
            >
              <RotateCcw className="h-4 w-4" />
              Restart
            </button>
            <button
              type="button"
              onClick={() => setRunning((currentRunning) => !currentRunning)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)] transition-colors hover:border-[var(--panel-border)]"
            >
              {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {running ? "Pause" : "Resume"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Score</p>
              <p className="mt-2 font-display text-3xl text-[var(--cream)]">{score}</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Lines</p>
              <p className="mt-2 font-display text-3xl text-[var(--cream)]">{lines}</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Level</p>
              <p className="mt-2 font-display text-3xl text-[var(--cream)]">{level}</p>
            </div>
          </div>

          <div className="mt-5 rounded-[22px] border border-white/8 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Next piece</p>
                <p className="mt-2 text-sm text-[var(--sand)]">
                  {gameOver
                    ? "Stack topped out. Restart to run another board."
                    : "Arrows move. Up rotates. Space hard-drops."}
                </p>
              </div>
              <div className="grid gap-1 rounded-[18px] bg-black/20 p-3">
                {nextPreview.map((row, rowIndex) => (
                  <div key={rowIndex} className="grid grid-cols-4 gap-1">
                    {Array.from({ length: 4 }, (_, columnIndex) => {
                      const value = row[columnIndex] ?? 0;
                      return (
                        <div
                          key={columnIndex}
                          className={`h-4 w-4 rounded-[4px] ${value ? getCellClass(nextShapeIndex + 1) : "bg-white/5"}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/8 bg-black/20 p-5">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => rotatePiece()}
              className="inline-flex items-center justify-center gap-2 rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-all hover:-translate-y-0.5 hover:border-[var(--panel-border)]"
              aria-label="Rotate piece"
            >
              <RotateCw className="h-4 w-4" />
              Rotate
            </button>
            <button
              type="button"
              onClick={() => hardDrop()}
              className="inline-flex items-center justify-center gap-2 rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-all hover:-translate-y-0.5 hover:border-[var(--panel-border)]"
              aria-label="Drop piece"
            >
              <ArrowDown className="h-4 w-4" />
              Drop
            </button>
            <button
              type="button"
              onClick={() => moveHorizontally(-1)}
              className="inline-flex items-center justify-center gap-2 rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-all hover:-translate-y-0.5 hover:border-[var(--panel-border)]"
              aria-label="Move left"
            >
              <ArrowLeft className="h-4 w-4" />
              Left
            </button>
            <button
              type="button"
              onClick={() => moveHorizontally(1)}
              className="inline-flex items-center justify-center gap-2 rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-all hover:-translate-y-0.5 hover:border-[var(--panel-border)]"
              aria-label="Move right"
            >
              <ArrowRight className="h-4 w-4" />
              Right
            </button>
            <button
              type="button"
              onClick={() => stepDown(true)}
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-all hover:-translate-y-0.5 hover:border-[var(--panel-border)]"
              aria-label="Soft drop"
            >
              <ArrowDown className="h-4 w-4" />
              Soft drop
            </button>
          </div>

          <div className="mt-5 rounded-[22px] border border-white/8 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Best run</p>
            <p className="mt-2 font-display text-3xl text-[var(--cream)]">{best}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

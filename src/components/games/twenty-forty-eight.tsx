"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw } from "lucide-react";

type Direction = "up" | "down" | "left" | "right";
type Board = number[][];

const GRID_SIZE = 4;
const STORAGE_KEY = "arfor-2048-state";
const BEST_KEY = "arfor-2048-best";

function createEmptyBoard() {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
}

function addRandomTile(board: Board) {
  const emptyCells: Array<[number, number]> = [];

  board.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === 0) {
        emptyCells.push([rowIndex, columnIndex]);
      }
    });
  });

  if (!emptyCells.length) {
    return board;
  }

  const [row, column] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  const nextBoard = board.map((boardRow) => [...boardRow]);
  nextBoard[row][column] = Math.random() < 0.9 ? 2 : 4;
  return nextBoard;
}

function createStartingBoard() {
  return addRandomTile(addRandomTile(createEmptyBoard()));
}

function collapseLine(line: number[]) {
  const compact = line.filter(Boolean);
  const nextLine: number[] = [];
  let gainedScore = 0;

  for (let index = 0; index < compact.length; index += 1) {
    if (compact[index] === compact[index + 1]) {
      const merged = compact[index] * 2;
      nextLine.push(merged);
      gainedScore += merged;
      index += 1;
    } else {
      nextLine.push(compact[index]);
    }
  }

  while (nextLine.length < GRID_SIZE) {
    nextLine.push(0);
  }

  return { line: nextLine, gainedScore };
}

function boardsEqual(first: Board, second: Board) {
  return first.every((row, rowIndex) =>
    row.every((value, columnIndex) => value === second[rowIndex][columnIndex]),
  );
}

function moveBoard(board: Board, direction: Direction) {
  const nextBoard = createEmptyBoard();
  let gainedScore = 0;

  for (let index = 0; index < GRID_SIZE; index += 1) {
    const line =
      direction === "left" || direction === "right"
        ? [...board[index]]
        : board.map((row) => row[index]);

    const orientedLine =
      direction === "right" || direction === "down" ? [...line].reverse() : line;
    const collapsed = collapseLine(orientedLine);
    gainedScore += collapsed.gainedScore;
    const restoredLine =
      direction === "right" || direction === "down"
        ? [...collapsed.line].reverse()
        : collapsed.line;

    restoredLine.forEach((value, lineIndex) => {
      if (direction === "left" || direction === "right") {
        nextBoard[index][lineIndex] = value;
      } else {
        nextBoard[lineIndex][index] = value;
      }
    });
  }

  const moved = !boardsEqual(board, nextBoard);
  return { board: moved ? addRandomTile(nextBoard) : board, moved, gainedScore };
}

function canMove(board: Board) {
  return (["up", "down", "left", "right"] as Direction[]).some(
    (direction) => moveBoard(board, direction).moved,
  );
}

function getTileClass(value: number) {
  if (value === 0) return "bg-white/5 text-transparent";
  if (value === 2) return "bg-[#f2d49f] text-black";
  if (value === 4) return "bg-[#e8c47c] text-black";
  if (value === 8) return "bg-[#dba24f] text-black";
  if (value === 16) return "bg-[#b5c478] text-black";
  if (value === 32) return "bg-[#7cc4ff] text-black";
  if (value === 64) return "bg-[#4a88c7] text-white";
  if (value === 128) return "bg-[#8b71d6] text-white";
  if (value === 256) return "bg-[#ff8d7c] text-black";
  if (value === 512) return "bg-[#ff6f61] text-white";
  if (value === 1024) return "bg-[#ffd54f] text-black";
  return "bg-[#f7b3e8] text-black";
}

export function TwentyFortyEightGame() {
  const [board, setBoard] = useState<Board>(createStartingBoard);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [won, setWon] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const status = useMemo(() => {
    if (gameOver) return "Grid locked. Reset and run it again.";
    if (won) return "2048 reached. Keep pushing or bank the win.";
    return "Use arrows, WASD, or the touch pad below.";
  }, [gameOver, won]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const savedBest = window.localStorage.getItem(BEST_KEY);

      if (savedBest) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- saved best score is restored from local storage after mount.
        setBest(Number(savedBest));
      }

      if (!saved) {
        return;
      }

      const parsed = JSON.parse(saved) as {
        board: Board;
        score: number;
        won: boolean;
        gameOver: boolean;
      };

      if (parsed?.board?.length === GRID_SIZE) {
        setBoard(parsed.board);
        setScore(parsed.score ?? 0);
        setWon(Boolean(parsed.won));
        setGameOver(Boolean(parsed.gameOver));
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        board,
        score,
        won,
        gameOver,
      }),
    );
  }, [board, score, won, gameOver]);

  useEffect(() => {
    window.localStorage.setItem(BEST_KEY, String(best));
  }, [best]);

  function resetGame() {
    setBoard(createStartingBoard());
    setScore(0);
    setWon(false);
    setGameOver(false);
  }

  function handleMove(direction: Direction) {
    if (gameOver) {
      return;
    }

    const next = moveBoard(board, direction);
    if (!next.moved) {
      return;
    }

    const nextScore = score + next.gainedScore;
    const nextWon = won || next.board.some((row) => row.some((value) => value >= 2048));
    const nextGameOver = !canMove(next.board);

    setBoard(next.board);
    setScore(nextScore);
    setWon(nextWon);
    setGameOver(nextGameOver);
    setBest((current) => Math.max(current, nextScore));
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const keyMap: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      a: "left",
      s: "down",
      d: "right",
      W: "up",
      A: "left",
      S: "down",
      D: "right",
    };

    const direction = keyMap[event.key];
    if (!direction) {
      return;
    }

    event.preventDefault();
    handleMove(direction);
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const controls: Array<{ label: string; direction: Direction; icon: typeof ArrowUp }> = [
    { label: "Up", direction: "up", icon: ArrowUp },
    { label: "Left", direction: "left", icon: ArrowLeft },
    { label: "Down", direction: "down", icon: ArrowDown },
    { label: "Right", direction: "right", icon: ArrowRight },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
      <section className="rounded-[28px] border border-white/8 bg-black/20 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
            MIT source lane
          </div>
          <button
            type="button"
            onClick={resetGame}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[var(--cream)] transition-colors hover:border-[var(--panel-border)]"
          >
            <RotateCcw className="h-4 w-4" />
            New game
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Score</p>
            <p className="mt-2 font-display text-4xl text-[var(--cream)]">{score}</p>
          </div>
          <div className="rounded-[22px] border border-white/8 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Best</p>
            <p className="mt-2 font-display text-4xl text-[var(--cream)]">{best}</p>
          </div>
        </div>

        <p className="mt-5 text-sm leading-6 text-[var(--sand)]">{status}</p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {controls.map(({ label, direction, icon: Icon }) => (
            <button
              key={direction}
              type="button"
              onClick={() => handleMove(direction)}
              className="inline-flex items-center justify-center gap-2 rounded-[20px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-[var(--cream)] transition-all hover:-translate-y-0.5 hover:border-[var(--panel-border)]"
              aria-label={`Move ${label.toLowerCase()}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[32px] border border-white/8 bg-[rgba(5,5,7,0.55)] p-4 sm:p-5">
        <div className="grid grid-cols-4 gap-3 rounded-[28px] bg-white/5 p-3 sm:gap-4 sm:p-4">
          {board.flat().map((value, index) => (
            <div
              key={index}
              className={`flex aspect-square items-center justify-center rounded-[22px] text-2xl font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors sm:text-3xl ${getTileClass(value)}`}
            >
              {value || ""}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

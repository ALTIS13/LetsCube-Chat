interface TaskOpenButtonProps {
  title: string;
  onClick: () => void;
}

export function TaskOpenButton({ title, onClick }: TaskOpenButtonProps) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onClick}
      // Stretch the pointer target without making the selection checkbox a child of the button.
      className="block max-w-full truncate text-left after:absolute after:inset-0 after:cursor-pointer after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[color:var(--kub-cyan)]"
    >
      {title}
    </button>
  );
}

/** Overlay spinner shown while a render is in flight. */
export default function Spinner() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-9 h-9 rounded-full border-2 border-neutral-600 border-t-white animate-spin" />
    </div>
  );
}

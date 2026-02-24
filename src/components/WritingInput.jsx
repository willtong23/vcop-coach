export default function WritingInput({ value, onChange, disabled }) {
  return (
    <div className="writing-input-wrapper">
      <label htmlFor="writing-input" className="input-label">
        Paste your writing here 📝
      </label>
      <textarea
        id="writing-input"
        className="writing-input"
        placeholder="Once upon a time, in a land far away..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={8}
      />
    </div>
  );
}

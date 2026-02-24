export default function AnalyzeButton({ onClick, loading, disabled }) {
  return (
    <button
      className="analyze-button"
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? (
        <span className="button-loading">
          <span className="spinner" />
          Analyzing...
        </span>
      ) : (
        "Analyze My Writing ✨"
      )}
    </button>
  );
}

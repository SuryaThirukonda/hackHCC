import { Component } from "react";

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-fallback">
        <section>
          <p className="eyebrow">Startup error</p>
          <h1>Physio failed to load</h1>
          <p>{this.state.error.message || "A render error stopped the app."}</p>
          <button type="button" onClick={() => window.location.reload()}>Reload app</button>
        </section>
      </main>
    );
  }
}

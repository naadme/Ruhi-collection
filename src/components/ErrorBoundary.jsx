import { Component } from 'react'
import { Link } from 'react-router-dom'

// Keeps one broken component from blanking the whole app. Uses a class
// component because error boundaries cannot be written with hooks.
export default class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('Render error:', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="text-center py-32 px-4">
        <h1 className="text-[44px]">Something went wrong</h1>
        <p className="text-xl text-black/60 mt-4">Please try again. If it keeps happening, contact us and we'll help.</p>
        <div className="flex flex-wrap gap-4 justify-center">
          <button onClick={() => this.setState({ error: null })} className="btn-outline mt-8">Try again</button>
          <Link to="/" onClick={() => this.setState({ error: null })} className="btn-outline mt-8">Back to home</Link>
        </div>
      </section>
    )
  }
}

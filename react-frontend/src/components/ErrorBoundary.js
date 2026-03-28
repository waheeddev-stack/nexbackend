import React from "react";
import PropTypes from "prop-types";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError() {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log error details
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    this.setState({
      error: error,
      errorInfo: errorInfo,
    });

    // Log to external service in production
    if (process.env.REACT_APP_ENVIRONMENT === "production") {
      // You can integrate with error reporting services like Sentry here
      console.error("Production Error:", {
        error: error.toString(),
        errorInfo: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-container">
            <div className="error-icon">⚠️</div>
            <h2>Oops! Something went wrong</h2>
            <p>We&apos;re sorry, but something unexpected happened.</p>

            {process.env.REACT_APP_ENVIRONMENT === "development" && (
              <details className="error-details">
                <summary>Error Details (Development Mode)</summary>
                <pre className="error-stack">
                  {this.state.error && this.state.error.toString()}
                  <br />
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            <div className="error-actions">
              <button onClick={this.handleRetry} className="retry-button">
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="reload-button"
              >
                Reload Page
              </button>
            </div>
          </div>

          <style>
            {`
              .error-boundary {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                padding: 20px;
                background-color: #f8f9fa;
              }

              .error-container {
                max-width: 500px;
                text-align: center;
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              }

              .error-icon {
                font-size: 48px;
                margin-bottom: 20px;
              }

              .error-container h2 {
                color: #dc3545;
                margin-bottom: 16px;
                font-size: 24px;
              }

              .error-container p {
                color: #6c757d;
                margin-bottom: 24px;
                line-height: 1.5;
              }

              .error-details {
                text-align: left;
                margin: 20px 0;
                padding: 16px;
                background-color: #f8f9fa;
                border-radius: 8px;
                border: 1px solid #dee2e6;
              }

              .error-details summary {
                cursor: pointer;
                font-weight: 600;
                color: #495057;
                margin-bottom: 12px;
              }

              .error-stack {
                font-family: "Courier New", monospace;
                font-size: 12px;
                color: #dc3545;
                white-space: pre-wrap;
                overflow-x: auto;
                max-height: 200px;
                overflow-y: auto;
              }

              .error-actions {
                display: flex;
                gap: 12px;
                justify-content: center;
                flex-wrap: wrap;
              }

              .retry-button,
              .reload-button {
                padding: 12px 24px;
                border: none;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
              }

              .retry-button {
                background-color: #007bff;
                color: white;
              }

              .retry-button:hover {
                background-color: #0056b3;
              }

              .reload-button {
                background-color: #6c757d;
                color: white;
              }

              .reload-button:hover {
                background-color: #545b62;
              }

              @media (max-width: 480px) {
                .error-container {
                  padding: 24px;
                  margin: 0 16px;
                }

                .error-actions {
                  flex-direction: column;
                }

                .retry-button,
                .reload-button {
                  width: 100%;
                }
              }
            `}
          </style>
        </div>
      );
    }

    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ErrorBoundary;

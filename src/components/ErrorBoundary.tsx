/**
 * React Error Boundary for catching errors in child components
 * 
 * Usage: Wrap any component that might crash (modals, modals dialogs, etc.)
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
};

class ClassErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true, error: _ };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({
      error,
      errorInfo,
    });
    console.error('[ERROR BOUNDARY]', error?.message, errorInfo);
  }

  render(): React.JSX.Element {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center min-h-screen bg-red-50 p-8">
          <div className="text-center max-w-md bg-white rounded-lg shadow-xl p-6 border-2 border-red-200">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Something went wrong</h1>
            <p className="text-gray-600 mb-4">
              An error occurred in a dialog or modal. Please refresh the page to continue.
            </p>
            {this.state.error && (
              <details className="text-left text-sm bg-gray-50 p-3 rounded border border-gray-200">
                <summary className="font-medium cursor-pointer text-red-600 hover:text-red-700">
                  Show error details
                </summary>
                <pre className="mt-2 text-xs overflow-auto whitespace-pre-wrap max-h-48">
                  {this.state.error.message}
                  {this.state.error.stack && (
                    <>
                      <code className="block mt-2 text-gray-500">{this.state.error.stack}</code>
                    </>
                  )}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function ErrorBoundary({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return <ClassErrorBoundary children={children} fallback={fallback} />;
}

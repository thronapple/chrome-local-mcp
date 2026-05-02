declare module "chrome-remote-interface" {
  export interface Client {
    Browser: {
      getVersion(): Promise<any>;
    };
    Page: {
      enable(): Promise<void>;
      navigate(params: { url: string }): Promise<any>;
      loadEventFired(): Promise<any>;
      captureScreenshot(params?: {
        format?: string;
        captureBeyondViewport?: boolean;
      }): Promise<{ data: string }>;
      bringToFront(): Promise<void>;
      getNavigationHistory(): Promise<{
        currentIndex: number;
        entries: Array<{ id: number; url: string; title: string }>;
      }>;
      navigateToHistoryEntry(params: { entryId: number }): Promise<void>;
    };
    Runtime: {
      enable(): Promise<void>;
      evaluate(params: {
        expression: string;
        returnByValue?: boolean;
        awaitPromise?: boolean;
      }): Promise<{
        result: { type: string; value?: any; description?: string };
        exceptionDetails?: {
          text: string;
          exception?: { description?: string };
        };
      }>;
    };
    Network: {
      enable(): Promise<void>;
    };
    DOM: {
      enable(): Promise<void>;
    };
    Input: {
      dispatchMouseEvent(params: {
        type: string;
        x: number;
        y: number;
        button?: string;
        clickCount?: number;
      }): Promise<void>;
      dispatchKeyEvent(params: {
        type: string;
        key?: string;
        text?: string;
        windowsVirtualKeyCode?: number;
      }): Promise<void>;
    };
    Target: {
      createTarget(params: { url: string }): Promise<{ targetId: string }>;
      closeTarget(params: { targetId: string }): Promise<void>;
      getTargetInfo(params?: { targetId?: string }): Promise<{
        targetInfo: { targetId: string; title: string; url: string; type: string };
      }>;
    };
    target: string;
    close(): Promise<void>;
  }

  interface CDPOptions {
    host?: string;
    port?: number;
    target?: string;
  }

  function CDP(options?: CDPOptions): Promise<Client>;

  namespace CDP {
    function List(options?: {
      host?: string;
      port?: number;
    }): Promise<
      Array<{ id: string; title: string; url: string; type: string }>
    >;
  }

  export = CDP;
}

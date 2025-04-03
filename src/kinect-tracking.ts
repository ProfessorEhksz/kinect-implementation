import * as Kinect2 from "kinect2";
import { WebSocket, WebSocketServer } from "ws";

import { BodyFrame, EventTypes, Kinect2Wrapper } from "./kinect-wrapper.js";

const PORT = 8080;

const kinect = new Kinect2Wrapper();
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws: WebSocket) => {
  console.log("Client connected to WebSocket");

  ws.on("close", () => {
    console.log("Client disconnected from WebSocket");
  });
});

interface ErrorWithMessage {
  message: string;
}

function broadcastData(data: KinectWSMessage): void {
  if (wss.clients.size === 0) return;

  const message = JSON.stringify(data);
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function handleError(error: unknown) {
  const errorWithMessage = toErrorWithMessage(error);
  console.error(errorWithMessage.message);
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return typeof error === "object" && error !== null && "message" in error && typeof (error as Record<string, unknown>).message === "string";
}

function toErrorWithMessage(error: unknown): ErrorWithMessage {
  if (isErrorWithMessage(error)) return error;

  try {
    return new Error(String(error));
  } catch {
    return new Error("Unknown error");
  }
}

console.log("Initializing Kinect sensor...");

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  cleanup().catch(console.error);
});

process.on("SIGINT", () => {
  console.log("Application interrupted");
  cleanup().catch(console.error);
});

interface KinectWSMessage {
  rightHand: {
    isClosed: boolean;
    x: number;
    y: number;
  };
  slideState: "next" | "previous" | null;
  timestamp: number;
}

async function cleanup(): Promise<void> {
  console.log("Cleaning up resources...");
  try {
    await kinect.close();
    console.log("Kinect sensor closed successfully");

    // Close WebSocket server
    wss.close((err?: Error) => {
      if (err) {
        console.error("Error closing WebSocket server:");
        handleError(err);
      } else {
        console.log("WebSocket server closed");
      }
    });
  } catch (error) {
    console.error("Error closing Kinect sensor:");
    handleError(error);
    throw error;
  } finally {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  try {
    await kinect.open();
    console.log("Kinect sensor opened successfully");

    console.log("Starting body tracking...");
    await kinect.trackBodies();
    console.log("Body tracking started");

    kinect.on(EventTypes.bodyFrame, (bodyFrame: BodyFrame) => {
      const nearestPerson = kinect.findNearestPerson();
      const message: KinectWSMessage = {
        rightHand: {
          isClosed: false,
          x: 0.5,
          y: 0.5,
        },
        slideState: null,
        timestamp: Date.now(),
      };
      if (nearestPerson) {
        const leftHandJoint = nearestPerson.joints[Kinect2.default.JointType.handLeft];
        const rightHandJoint = nearestPerson.joints[Kinect2.default.JointType.handRight];
        message.rightHand.x = rightHandJoint.depthX;
        message.rightHand.y = rightHandJoint.depthY;

        const leftHandSwipe = kinect.trackHand(leftHandJoint, "left", bodyFrame.timestamp || Date.now());
        const rightHandSwipe = kinect.trackHand(rightHandJoint, "right", bodyFrame.timestamp || Date.now());

        const gestures = kinect.detectGestures(nearestPerson);

        if (gestures.handStates.right === "closed") {
          console.log("Holding!!!");
          message.rightHand.isClosed = true;
        }

        if (leftHandSwipe) {
          if (leftHandSwipe.direction === "right") {
            console.log("Previous Slie!");
            message.slideState = "previous";
          }
        }

        if (rightHandSwipe) {
          if (rightHandSwipe.direction === "left") {
            message.slideState = "next";
          }
        }

        broadcastData(message);
      } else {
        kinect.resetHandPositions();
      }
    });

    console.log("Tracking started. Press Ctrl+C to exit.");
  } catch (error) {
    console.error("Error in main function:", error);
    await cleanup();
  }
}

main().catch(console.error);

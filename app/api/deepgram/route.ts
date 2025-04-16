import { DeepgramError, createClient } from "@deepgram/sdk";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";

export async function GET(request: Request) {
  logger.info(`Received request for Deepgram temporary key: ${request.url}`);

  // gotta use the request object to invalidate the cache every request :vomit:
  const url = request.url;
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY ?? "";

  if (!deepgramApiKey) {
    const errorMsg = "Deepgram API Key not found in environment variables.";
    logger.error(errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }

  const deepgram = createClient(deepgramApiKey);

  try {
    logger.info("Fetching Deepgram projects...");
    let { result: projectsResult, error: projectsError } =
      await deepgram.manage.getProjects();

    if (projectsError) {
      logger.error("Error fetching Deepgram projects:", projectsError);
      return NextResponse.json(projectsError);
    }

    const project = projectsResult?.projects[0];

    if (!project) {
      const errorMsg = "Cannot find a Deepgram project. Please create a project first.";
      logger.error(errorMsg);
      return NextResponse.json(
        new DeepgramError(errorMsg),
      );
    }

    logger.info(`Found project ID: ${project.project_id}. Creating temporary key...`);
    let { result: newKeyResult, error: newKeyError } =
      await deepgram.manage.createProjectKey(project.project_id, {
        comment: "Temporary API key",
        scopes: ["usage:write"],
        tags: ["next.js"],
        time_to_live_in_seconds: 10,
      });

    if (newKeyError) {
      logger.error("Error creating Deepgram temporary key:", newKeyError);
      return NextResponse.json(newKeyError);
    }

    logger.info("Successfully created Deepgram temporary key.");
    return NextResponse.json({ ...newKeyResult, url });
  } catch (error) {
    logger.error("Unhandled error in Deepgram route:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

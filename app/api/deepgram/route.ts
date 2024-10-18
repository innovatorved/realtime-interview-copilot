import { NextResponse } from "next/server";

const DEEPGRAM_APIKEY = process.env.DEEPGRAM_API_KEY!;

export async function GET(request: Request) {
  const url = request.url;

  const projectsResponse = await fetch("https://api.deepgram.com/v1/projects", {
    method: "GET",
    headers: {
      Authorization: `Token ${DEEPGRAM_APIKEY}`,
      accept: "application/json",
    },
  });

  const projectsResult = await projectsResponse.json();

  if (!projectsResponse.ok) {
    return NextResponse.json(projectsResult);
  }

  const project = projectsResult.projects[0];

  if (!project) {
    return NextResponse.json({
      error: "Cannot find a Deepgram project. Please create a project first.",
    });
  }

  const newKeyResponse = await fetch(
    `https://api.deepgram.com/v1/projects/${project.project_id}/keys`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_APIKEY}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        comment: "Temporary API key",
        scopes: ["usage:write"],
        tags: ["next.js"],
        time_to_live_in_seconds: 10,
      }),
    },
  );

  const newKeyResult = await newKeyResponse.json();

  if (!newKeyResponse.ok) {
    return NextResponse.json(newKeyResult);
  }

  return NextResponse.json({ ...newKeyResult, url });
}

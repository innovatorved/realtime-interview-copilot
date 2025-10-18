"use server";

const DEEPGRAM_APIKEY = process.env.DEEPGRAM_API_KEY!;

const getTempDeepgramAPIKEY = async () => {
  const projectsResponse = await fetch("https://api.deepgram.com/v1/projects", {
    method: "GET",
    headers: {
      Authorization: `Token ${DEEPGRAM_APIKEY}`,
      accept: "application/json",
    },
  });

  const projectsResult = (await projectsResponse.json()) as {
    projects: Array<{ project_id: string }>;
  };

  if (!projectsResponse.ok) {
    return projectsResult;
  }

  const project = projectsResult.projects[0];

  if (!project) {
    return {
      error: "Cannot find a Deepgram project. Please create a project first.",
    };
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

  const newKeyResult = (await newKeyResponse.json()) as Record<string, unknown>;

  if (!newKeyResponse.ok) {
    return newKeyResult;
  }

  return { ...newKeyResult };
};

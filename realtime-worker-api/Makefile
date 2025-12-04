approve:
	@if [ -z "$(email)" ]; then \
		echo "Usage: make approve email=<user_email>"; \
		exit 1; \
	fi
	npx wrangler d1 execute realtime-interview-copilot-db --remote --command "UPDATE user SET isApproved = 1 WHERE email = '$(email)'"

# Council

This project is a simple council of AI agents. Each agent has a specific role and has access to a list of tools they can use.

This project uses Nextjs app router and server actions for the core functionality.

Vercel AI and Upstash llms.txt files are present in the repo to help coding agents.

## File Structure

Each agent has access to its system prompt and a list of memories that serve as the knowledge base for the agent.

## Agent

Each agent has a name and a system prompt that serves as a guide for agent's characteristics and behavior.

Agents have only one active session at a time (called "default").

Conversation history is stored for each session.

User can start a new session that will override the default session and start a new conversation.

## Database

This project is built on top of Upstash stack.

It uses Redis as a database, QStash as messaging and scheduling system and Vector for semantic search through memories.

## Tools

- update_system_prompt: Agent can decide to update its system prompt. It will help the agent to adapt to new information and changes in the environment.
- memory_add: Agent can add a new memory to its knowledge base. It will help the agent to remember new information and changes in the environment.
- memory_search: Agent can search its knowledge base for relevant information. It will help the agent to answer questions and provide information.
- web_search: Agent can search the web for relevant information. It will help the agent to answer questions and provide information.
- sessions_list: Agent can list all its sessions. It will help the user to see all the conversations with the agent.

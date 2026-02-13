# Council

This project is a simple council of AI agents. Each agent has a specific role and has access to a list of tools they can use.

This project uses Nextjs app router and server actions for the core functionality.

Agents have only one active session at a time (called "default").

## File Structure

Each agent has access to a list of markdown files that serve as the knowledge base for the agent.

## Agent

Each agent has a name and a system prompt that serves as a guide for agent's characteristics and behavior.

We only keep conversation history for the default session.

User can start a new session that will override the default session and start a new conversation.

## Database

This project is built on top of Upstash stack. It uses Redis as a database, QStash as messaging and scheduling system and Vector for semantic search through memories.

## Tools

-

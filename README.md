# Hemköp shopper
Hemköp shopper is an application that puts items from an arbitrary recipe link into a basket on Hemköp's website hemkop.se. The main use case is to simplify shopping for groceries by automation.

It uses a local Ollama LLM of choice to process hemkop.se search results. The Ollama client must be running for the application to work.

To run the script, simply run:

```
yarn start <recipe_link>
```

The code was written almost in its entirety using Cursor with Claude 3.7 Sonnet.

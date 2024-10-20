const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const multer = require('multer');
const { OpenAI } = require('openai');
// const fs = require('fs');
// const { ObjectId } = require('mongodb');
dotenv.config();


// Set up OpenAI client with your API key
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY});

const app = express();
app.use(express.json());

let assistant_id = null; // Declare assistant globally

// Function to initialize the assistant
async function initializeAssistant() {
  if (!assistant_id) {
    console.log('Initializing assistant...');

  const assistant = await openai.beta.assistants.create({
      name: "PDF File QA Assistant",
      instructions: "You are an assistant who answers questions based on the content of uploaded PDF files.",
      tools: [{ type: "file_search" }],
      model: "gpt-4o",
    });
    assistant_id = assistant.id;
  }
}

// Function to ensure the assistant is initialized
async function ensureAssistantInitialized() {
  if (!assistant_id) {
    await initializeAssistant();
  }
}

ensureAssistantInitialized()

// MongoDB setup
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define schema and model for UploadedDocument
const uploadedDocumentSchema = new mongoose.Schema({
  file_name: String,
  vector_store_id: String,
});

const UploadedDocument = mongoose.model('UploadedDocument', uploadedDocumentSchema);

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// API 1: Upload document and create a vector store
app.post('/upload-document', upload.single('pdf_file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    const pdfFile = req.file;
    const fileName = pdfFile.originalname;

    // Create a vector store using OpenAI
    const vectorStore = await createVectorStore(pdfFile, fileName);

    // Save document details to MongoDB
    const newDocument = new UploadedDocument({
      file_name: fileName,
      vector_store_id: vectorStore.id,
    });

    await newDocument.save();

    res.status(201).json({
      file_name: fileName,
      vector_store_id: vectorStore.id,
    });
  } catch (error) {
    console.error('Error during document upload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API 2: Fetch document information from MongoDB
app.get('/documents', async (req, res) => {
  try {
    const documents = await UploadedDocument.find({}, 'file_name vector_store_id');
    res.json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API 3: Ask a question using the vector store
app.post('/ask-question', async (req, res) => {
  let { question, vector_store_id } = req.body;

  if (!question || !vector_store_id) {
    return res.status(400).json({ error: "Both 'question' and 'vector_store_id' are required." });
  }
  question = `${question}. Please do not send any relevant links, and also unwanted characters in the answer.`;

  try {
    // Get the answer from OpenAI using vector store
    const answer = await askQuestion(question, vector_store_id);

    res.json({ question, answer });
  } catch (error) {
    console.error('Error asking question:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Function to create a vector store and upload file content
async function createVectorStore(file, vectorStoreName) {
  try {
    // Create a vector store using OpenAI
    const vectorStore = await openai.beta.vectorStores.create({
      name: vectorStoreName,
    });
    console.log(`Vector store created with ID: ${vectorStore.id}`);
    return vectorStore;
  } catch (error) {
    console.error("Error during document upload:", error);
    throw error;
  }
}


async function askQuestion(question, vector_store_id) {  // Added vector_store_id parameter
  console.log('question',question )
  console.log('vector_store_id',vector_store_id )
  try {

    // const threadResponse = await openai.beta.threads.create({
    //   // Pass vector_store_id when creating a thread if needed here
    //   vector_store_id: vector_store_id // Use vector_store_id if the API supports it
    // });

    const threadResponse = await openai.beta.threads.create({
      messages: [{ role: 'user', content: question }],
      tool_resources: {
        file_search: {
          vector_store_ids: [vector_store_id],
        },
      },
    });

    const threadId = threadResponse.id;
 
    // Add a Message to a Thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: question,
    });

    // Run the Assistant
    const runResponse = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistant_id, // Assuming you have the assistant_id stored elsewhere
    });

    let run = await openai.beta.threads.runs.retrieve(threadId, runResponse.id);

    while (run.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await openai.beta.threads.runs.retrieve(threadId, runResponse.id);
    }

    // Display the Assistant's Response
    const messagesResponse = await openai.beta.threads.messages.list(threadId);
    const assistantResponses = messagesResponse.data.filter(msg => msg.role === 'assistant');
    
    const response = assistantResponses.map(msg => 
      msg.content
        .filter(contentItem => contentItem.type === 'text')
        .map(textContent => textContent.text.value)
        .join('\n')
    ).join('\n');

    console.log('response', response);
    return response;

  } catch (error) {
    console.error('Error during question processing:', error);
    throw error;
  }
}

  const PORT = process.env.PORT || 8000
  app.listen(PORT, () => {
    const data = {
      port: `Server is running perfectly on port ${PORT}`,
    }
    console.log(data)
  })
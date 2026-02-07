import os
import time
import uuid
import cloudinary
import cloudinary.uploader

from fastapi import FastAPI, UploadFile, File, HTTPException
from dotenv import load_dotenv
from pypdf import PdfReader
from fastapi.middleware.cors import CORSMiddleware

# LangChain
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI
try:
    from langchain.chains import create_retrieval_chain
    from langchain.chains.combine_documents import create_stuff_documents_chain
except ModuleNotFoundError:
    # Newer langchain installs move classic chains into langchain_classic
    from langchain_classic.chains import create_retrieval_chain
    from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate

# Pinecone
from pinecone import Pinecone, ServerlessSpec
from langchain_pinecone import PineconeVectorStore


############################################################
# LOAD ENV
############################################################

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PPLX_API_KEY = os.getenv("PPLX_API_KEY")

if not PINECONE_API_KEY:
    raise ValueError("Missing Pinecone API key (PINECONE_API_KEY)")

if not PPLX_API_KEY:
    raise ValueError("Missing Perplexity API key (PPLX_API_KEY)")


############################################################
# FASTAPI INIT
############################################################

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://ai-chat-frontend-720488150740.europe-west1.run.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

############################################################
# CLOUDINARY
############################################################

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET")
)

############################################################
# EMBEDDINGS (LOCAL + FREE)
############################################################

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

############################################################
# PINECONE
############################################################

pc = Pinecone(api_key=PINECONE_API_KEY)

INDEX_NAME = "pdf-chat"

existing_indexes = pc.list_indexes().names()

if INDEX_NAME not in existing_indexes:
    pc.create_index(
        name=INDEX_NAME,
        dimension=384,
        metric="cosine",
        spec=ServerlessSpec(
            cloud="aws",
            region="us-east-1"
        )
    )
    # Wait until the index is ready before using it
    for _ in range(60):
        status = pc.describe_index(INDEX_NAME).status
        if status and status.get("ready"):
            break
        time.sleep(1)

index = pc.Index(INDEX_NAME)

############################################################
# PERPLEXITY LLM
############################################################

llm = ChatOpenAI(
    api_key=PPLX_API_KEY,
    base_url="https://api.perplexity.ai",
    model="sonar",
    temperature=0
)

############################################################
# TEMP SESSION STORE
# (Use Redis in production)
############################################################

sessions = {}

############################################################
# UPLOAD PDF
############################################################

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):

    session_id = str(uuid.uuid4())

    try:
        if not os.getenv("CLOUDINARY_CLOUD_NAME") or not os.getenv("CLOUDINARY_API_KEY") or not os.getenv("CLOUDINARY_API_SECRET"):
            raise HTTPException(
                status_code=500,
                detail="Missing Cloudinary configuration (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)."
            )
        result = cloudinary.uploader.upload(
            file.file,
            resource_type="auto"
        )

        public_id = result["public_id"]

        file.file.seek(0)
        reader = PdfReader(file.file)

        text = ""

        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text += extracted

        if not text:
            raise HTTPException(
                status_code=400,
                detail="No readable text found in PDF."
            )

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )

        chunks = splitter.split_text(text)

        PineconeVectorStore.from_texts(
            chunks,
            embedding=embeddings,
            index_name=INDEX_NAME,
            namespace=session_id
        )

        sessions[session_id] = {
            "public_id": public_id,
            "filename": file.filename or "unnamed.pdf"
        }

        return {
            "message": "PDF uploaded successfully!",
            "session_id": session_id,
            "filename": file.filename or "unnamed.pdf"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


############################################################
# ASK QUESTION
############################################################

@app.get("/ask")
def ask_question(session_id: str, question: str):

    if session_id not in sessions:
        raise HTTPException(
            status_code=404,
            detail="Session not found."
        )

    try:
        vector_store = PineconeVectorStore(
            index=index,
            embedding=embeddings,
            namespace=session_id
        )

        retriever = vector_store.as_retriever(search_kwargs={"k": 3})

        prompt = ChatPromptTemplate.from_template("""
Answer ONLY from the provided context.
If the answer is not in the context, say:
"I could not find the answer in the document."

<context>
{context}
</context>

Question: {input}
""")

        document_chain = create_stuff_documents_chain(
            llm,
            prompt
        )

        retrieval_chain = create_retrieval_chain(
            retriever,
            document_chain
        )

        response = retrieval_chain.invoke({
            "input": question
        })

        return {"answer": response["answer"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


############################################################
# DELETE SESSION
############################################################

@app.delete("/delete")
def delete_session(session_id: str):

    if session_id not in sessions:
        raise HTTPException(
            status_code=404,
            detail="Session not found."
        )

    try:
        public_id = sessions[session_id]["public_id"]

        cloudinary.uploader.destroy(public_id)

        index.delete(
            delete_all=True,
            namespace=session_id
        )

        del sessions[session_id]

        return {"message": "Session deleted successfully"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from langchain_ollama.llms import OllamaLLM
from langchain_core.prompts import ChatPromptTemplate
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings
import pandas as pd
import os
from dotenv import load_dotenv

# 加载 .env 文件中的环境变量
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# DeepSeek 集成
from deepseek import query_deepseek

def split_text_into_chunks(text: str, chunk_size: int = 512, chunk_overlap: int = 50):
    """
    简单文本切片器：将文本按字符切分为长度为 chunk_size 的块，块之间重叠 chunk_overlap 字符。
    """
    if not text:
        return []
    chunks = []
    start = 0
    text_length = len(text)
    while start < text_length:
        end = start + chunk_size
        chunks.append(text[start:end])
        start = max(end - chunk_overlap, end) if end < text_length else end
    return chunks


# DeepSeek LLM 包装类
class DeepSeekLLM:
    """DeepSeek LLM 包装器，用于兼容 LangChain 接口"""
    
    def __init__(self, model_name="deepseek-chat"):
        self.model_name = model_name
    
    def invoke(self, prompt):
        """同步调用 DeepSeek"""
        try:
            # 尝试从 prompt 中提取问题
            question = ""
            answer_context = ""
            
            # 解析 prompt template
            if "用户提问：" in prompt:
                parts = prompt.split("用户提问：")
                if len(parts) > 1:
                    question_part = parts[1].split("\n")[0].strip()
                    question = question_part
            
            if "常见的回答：" in prompt:
                parts = prompt.split("常见的回答：")
                if len(parts) > 1:
                    answer_part = parts[1].split("用户提问：")[0].strip()
                    answer_context = answer_part
            
            # 调用 DeepSeek
            combined_query = f"{answer_context}\n\n用户问题: {question}".strip()
            
            results = query_deepseek(combined_query, k=3, timeout=10)
            
            if results and len(results) > 0:
                return results[0].get("text", "")
            return "抱歉，我无法回答您的问题。"
            
        except Exception as e:
            print(f"DeepSeek 调用错误: {e}")
            return f"调用 DeepSeek 时出错: {str(e)}"
    
    def stream(self, prompt):
        """流式调用 DeepSeek（返回生成器）"""
        result = self.invoke(prompt)
        yield result


# 创建聊天模板
template = """
你是一名专业的医生，请根据提供的医学知识回答用户的问题。

【医学知识参考】
{answer}

【用户问题】
{question}

【重要规则】
1. 只使用【医学知识参考】中与问题相关的内容来回答
2. 如果参考内容与问题无关，直接基于医学常识回答，不要牵强附会
3. 回答要专业、准确、简洁
4. 不要编造或推测与问题无关的信息
5. 语言简洁易懂，避免冗长
"""

prompt = ChatPromptTemplate.from_template(template)


# 模型切换逻辑
def get_model():
    """根据环境变量返回当前配置的模型"""
    use_deepseek = os.environ.get("USE_DEEPSEEK", "").lower() in ("true", "1", "yes")
    
    if use_deepseek:
        print("使用 DeepSeek 模型进行问诊")
        return DeepSeekLLM()
    else:
        print("使用 Ollama Llama3.2 模型进行问诊")
        return OllamaLLM(model="llama3.2")


# 获取当前模型实例和 chain
model = get_model()
chain = prompt | model  # 管道连接


# 加载数据
# 使用仓库相对路径，或通过环境变量覆盖（在 mac / linux 下可运行）
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
csv_path = os.environ.get("DOC_CSV_PATH", os.path.join(repo_root, "doc.csv"))
df = pd.read_csv(csv_path)

# 创建嵌入模型（可通过环境变量覆盖模型名）
embeddings = OllamaEmbeddings(model=os.environ.get("EMBEDDING_MODEL", "mxbai-embed-large"))

# 设置数据库存储位置（默认仓库下的 chroma 文件夹，可用 CHROMA_DB_PATH 覆盖）
db_location = os.environ.get("CHROMA_DB_PATH", os.path.join(repo_root, "chroma"))


# 切片器参数（使用仓库内的简单实现）
# chunk_size=512, chunk_overlap=50

# 如果数据库不存在，初始化 Chroma 向量存储
add_docs = not os.path.exists(db_location)
if add_docs:
    documents = []
    ids = []
    for i, row in df.iterrows():
        text = str(row.get("title", "")) + " " + str(row.get("answer", ""))
        chunks = split_text_into_chunks(text, chunk_size=512, chunk_overlap=50)
        for j, chunk in enumerate(chunks):
            document = Document(
                page_content=chunk,
                metadata={
                    "department": row["department"],
                    "title": row["title"],
                    "ask": row["ask"],
                    "source_row": i
                },
                id=f"{i}-{j}"  # 避免重复 ID
            )
            documents.append(document)
            ids.append(f"{i}-{j}")

vector_store = Chroma(
    collection_name="medical_chatbot",
    persist_directory=db_location,
    embedding_function=embeddings
)

if add_docs:
    vector_store.add_documents(documents=documents, ids=ids)

retriever = vector_store.as_retriever(
    search_kwargs={
        "k": 5
    }
)

from app.database import database_counts, initialize_database


if __name__ == "__main__":
    initialize_database()
    counts = database_counts()
    print("数据库初始化完成")
    print(f"法规数量：{counts['regulations']}")
    print(f"RAG 文档：{counts['rag_documents']}")
    print(f"RAG 文本块：{counts['rag_chunks']}")

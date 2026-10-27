
import os
from collections.abc import Iterator

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request
from openai import OpenAI

load_dotenv()

app = Flask(__name__)

api_key = os.getenv("GROQ_API_KEY")
client = None

if api_key:
    client = OpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1",
        timeout=60.0,
        max_retries=1,
    )


DOMAINS = {
    "general": "Tu es un assistant utile et pédagogique.",
    "informatique": (
        "Tu es un expert en informatique et programmation. "
        "Explique les concepts avec des exemples simples."
    ),
    "finance": (
        "Tu es un assistant spécialisé en finance. "
        "Explique les notions clairement et signale les incertitudes."
    ),
    "analyse_donnees": (
        "Tu es un expert en analyse de données, statistiques, "
        "Python, SQL et qualité des données."
    ),
}


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/prompt", methods=["POST"])
def prompt():
    if client is None:
        return jsonify(
            error="La clé GROQ_API_KEY est absente du fichier .env."
        ), 500

    if not request.is_json:
        return jsonify(error="Le format JSON est requis."), 415

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify(error="Le JSON envoyé est invalide."), 400

    messages = data.get("messages")
    domain = data.get("domain", "general")

    if domain not in DOMAINS:
        return jsonify(error="Le domaine sélectionné est invalide."), 400

    if not isinstance(messages, list) or not messages:
        return jsonify(error="La conversation est vide."), 400

    conversation = [
        {"role": "system", "content": DOMAINS[domain]}
    ]

    for message in messages:
        if not isinstance(message, dict):
            return jsonify(error="Un message est invalide."), 400

        role = message.get("role")
        content = message.get("content")

        if role not in ("user", "assistant"):
            return jsonify(error="Rôle de message invalide."), 400

        if not isinstance(content, str) or not content.strip():
            return jsonify(error="Un message est vide."), 400

        conversation.append({
            "role": role,
            "content": content.strip()
        })

    if conversation[-1]["role"] != "user":
        return jsonify(
            error="Le dernier message doit être une question utilisateur."
        ), 400

    try:
        # Initialise l'appel ici afin de détecter les erreurs API
        # avant de commencer à envoyer la réponse au navigateur.
        upstream = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=conversation,
            stream=True,
        )

    except Exception:
        app.logger.exception("Échec de l'appel initial à Groq")
        return jsonify(
            error=(
                "Groq n'a pas pu démarrer la réponse. "
                "Vérifie le terminal Flask pour le détail."
            )
        ), 502

    return Response(
        event_stream(upstream),
        content_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )


def event_stream(upstream) -> Iterator[str]:
    try:
        for chunk in upstream:
            if not chunk.choices:
                continue

            content = chunk.choices[0].delta.content

            if content:
                yield content

    except Exception:
        # Une erreur pendant le flux ne peut plus changer le statut HTTP.
        app.logger.exception("Erreur pendant le streaming Groq")
        yield (
            "\n\n[Erreur : la connexion à Groq a été interrompue "
            "pendant la génération.]"
        )


if __name__ == "__main__":
    app.run(debug=True)

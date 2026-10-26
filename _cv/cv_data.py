"""
CV content for eliarbogast.com — edit this file, then run:

    python3 _cv/build.py

That rewrites the CV panel in index.html and rebuilds the PDF at
cv/Eli_Arbogast_CV.pdf (see build.py for details).

Text conventions
  - Links use Markdown style: [MEClab](https://meclab.org)
  - Everything else is plain text; HTML special characters are escaped for you.
  - Order matters: entries appear in the order listed (newest first).

This folder starts with an underscore, so GitHub Pages (Jekyll) does not
publish it. Only the generated index.html section and the PDF go live.
"""

NAME = "Eli Arbogast"
WEBSITE = "https://eliarbogast.com"

# Shown under your name at the top of the PDF only (leave "" to omit).
# The website shows your email in its Contact panel instead.
PDF_CONTACT_LINE = "eliarbogast.com"

SKILLS = [
    ("Technical", "Python, R, MATLAB, Java, C++ · machine learning, evolutionary computation, "
                  "data analysis and visualization, web development"),
    ("Creative", "Music production and mixing, video production · cello, piano, guitar, drums"),
]

EDUCATION = [
    ("University of Vermont", "PhD in Computer Science (current)"),
    ("Carleton College", "BA in Biology, 2018–2022"),
]

EXPERIENCE = [
    dict(
        title="Graduate Research Assistant",
        org="[MEClab](https://meclab.org), University of Vermont",
        dates="2026–present",
        bullets=[
            "On the [Xenobots](https://xenobots.github.io/) project team, working on information-theoretic "
            "analysis and predictive modeling of xenobot behavior",
        ],
    ),
    dict(
        title="Machine Learning Engineer",
        org="US Positronix",
        dates="2023",
        bullets=[
            "Led multi-agent path planning for real-time robot motion in dynamic warehouse settings",
            "Modeled and animated robot movement in Blender",
        ],
    ),
    dict(
        title="Visiting Researcher",
        org="Ohio State University, Energy Sustainability Research Lab",
        dates="2022–2023",
        bullets=[
            "Estimated the potential for underground hydrogen storage in the US using MATLAB",
        ],
    ),
    dict(
        title="Wallace-Carver Fellow",
        org="U.S. Department of Agriculture",
        dates="2021",
        bullets=[
            "Analyzed 100,000+ soil carbon measurements, comparing traditional and equivalent-soil-mass "
            "methods, and presented the results to USDA soil scientists",
        ],
    ),
    dict(
        title="Research Assistant",
        org="Carleton College, Class of '55 Research Assistantship",
        dates="2021",
        bullets=[
            "Evolutionary computing research with Prof. Anya Vostinar: built evolution mechanics into "
            "Minecraft as an educational mod (Java), which became the basis for my senior CS research project",
        ],
    ),
    dict(
        title="Research Extern",
        org="Chicago Botanic Garden",
        dates="2019",
        bullets=[
            "Built statistical models in R of recent changes in native pollinator populations for the "
            "long-term Echinacea Project",
        ],
    ),
    dict(
        title="Borlaug-Ruan Intern",
        org="World Food Prize",
        dates="2018",
        bullets=[
            "Researched the environmental impacts of agriculture at EARTH University, Costa Rica; published "
            "and presented the paper at the World Food Prize conference",
        ],
    ),
]
